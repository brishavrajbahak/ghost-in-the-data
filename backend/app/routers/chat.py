from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from uuid import uuid4
from datetime import datetime, timezone
from collections import OrderedDict
import asyncio
import logging
import os

from app.services.enricher import get_news_context_cached
from app.services.narrator import generate_chat_reply, generate_chat_reply_agentic, generate_narrative
from app.services.tools import ToolExecutionError, load_dataframe_from_csv_text
from app.db import engine, SessionLocal
from app.models.db_models import AnalysisSession as AnalysisSessionModel, ChatSession as ChatSessionModel, ChatHistory as ChatHistoryModel
from app.rate_limit import limiter

router = APIRouter()
logger = logging.getLogger("ghost.chat")


class ChatStartRequest(BaseModel):
    anomaly_data: Dict[str, Any]
    correlation_data: List[str] = Field(default_factory=list)
    analysis_session_id: Optional[str] = None


class ChatSendRequest(BaseModel):
    session_id: str
    message: str


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    created_at: str
    meta: Optional[Dict[str, Any]] = None


class ChatSessionResponse(BaseModel):
    session_id: str
    messages: List[ChatMessage]
    articles: List[Dict[str, Any]] = Field(default_factory=list)
    analysis_session_id: Optional[str] = None


class _ChatSession:
    def __init__(self, *, anomaly_data: Dict[str, Any], correlation_data: List[str], articles: List[Dict[str, Any]], analysis_session_id: Optional[str]):
        self.anomaly_data = anomaly_data
        self.correlation_data = correlation_data
        self.articles = articles
        self.analysis_session_id = analysis_session_id
        self.messages: List[ChatMessage] = []


# In-memory chat state (MVP). For persistence, swap this for a DB later.
_SESSIONS_MAX = int(os.getenv("CHAT_SESSIONS_MAX", "100"))
_SESSIONS: "OrderedDict[str, _ChatSession]" = OrderedDict()
_SESSIONS_LOCK = asyncio.Lock()


async def _cache_get(session_id: str) -> Optional[_ChatSession]:
    async with _SESSIONS_LOCK:
        sess = _SESSIONS.get(session_id)
        if sess is not None:
            _SESSIONS.move_to_end(session_id)
        return sess


async def _cache_set(session_id: str, sess: _ChatSession) -> None:
    async with _SESSIONS_LOCK:
        _SESSIONS[session_id] = sess
        _SESSIONS.move_to_end(session_id)
        while len(_SESSIONS) > max(_SESSIONS_MAX, 1):
            _SESSIONS.popitem(last=False)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/chat/start", response_model=ChatSessionResponse)
@limiter.limit("10/minute")
async def start_chat(request: Request, payload: ChatStartRequest):
    anomaly = payload.anomaly_data or {}
    column = str(anomaly.get("column") or "").strip()
    ts = str(anomaly.get("timestamp") or "").strip()

    if not column:
        raise HTTPException(status_code=400, detail="Missing anomaly_data.column")

    # Seed external context (same idea as /narrate, but used for chat grounding too).
    search_query = f"{column} spike drop"
    articles = await get_news_context_cached(search_query, ts)

    # Create initial narrative as the first assistant message so the chat has a starting point.
    story = await generate_narrative(anomaly, payload.correlation_data, articles)

    session_id = str(uuid4())
    sess = _ChatSession(
        anomaly_data=anomaly,
        correlation_data=payload.correlation_data,
        articles=articles,
        analysis_session_id=payload.analysis_session_id,
    )
    sess.messages.append(ChatMessage(role="assistant", content=story, created_at=_now_iso()))
    await _cache_set(session_id, sess)

    if engine is not None and SessionLocal is not None:
        try:
            async with SessionLocal() as db:
                chat_row = ChatSessionModel(
                    id=session_id,
                    analysis_session_id=payload.analysis_session_id,
                    anomaly_index=int(anomaly.get("index")) if anomaly.get("index") is not None else None,
                    anomaly_data=anomaly,
                    correlation_data=payload.correlation_data,
                    articles=articles,
                )
                db.add(chat_row)
                db.add(ChatHistoryModel(chat_session_id=session_id, role="assistant", content=story, meta=None))
                await db.commit()
        except Exception:
            logger.exception("Chat persistence failed; continuing without DB history.")

    return ChatSessionResponse(
        session_id=session_id,
        messages=sess.messages,
        articles=articles,
        analysis_session_id=payload.analysis_session_id,
    )


@router.post("/chat/send", response_model=ChatSessionResponse)
@limiter.limit("20/minute")
async def send_message(request: Request, payload: ChatSendRequest):
    session_id = (payload.session_id or "").strip()
    msg = (payload.message or "").strip()
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")
    if not msg:
        raise HTTPException(status_code=400, detail="Missing message")

    sess = await _cache_get(session_id)
    if not sess:
        # Try hydrating from DB (persistence).
        if engine is None or SessionLocal is None:
            raise HTTPException(status_code=404, detail="Unknown session_id")
        try:
            from sqlalchemy import select
            async with SessionLocal() as db:
                chat_row = (await db.execute(select(ChatSessionModel).where(ChatSessionModel.id == session_id))).scalar_one_or_none()
                if not chat_row:
                    raise HTTPException(status_code=404, detail="Unknown session_id")
                sess = _ChatSession(
                    anomaly_data=chat_row.anomaly_data,
                    correlation_data=chat_row.correlation_data,
                    articles=chat_row.articles,
                    analysis_session_id=chat_row.analysis_session_id,
                )
                msgs = (await db.execute(select(ChatHistoryModel).where(ChatHistoryModel.chat_session_id == session_id).order_by(ChatHistoryModel.id.asc()))).scalars().all()
                sess.messages = [
                    ChatMessage(
                        role=m.role,
                        content=m.content,
                        created_at=m.created_at.isoformat(),
                        meta=getattr(m, "meta", None),
                    )
                    for m in msgs
                ]
                await _cache_set(session_id, sess)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=404, detail="Unknown session_id")

    sess.messages.append(ChatMessage(role="user", content=msg, created_at=_now_iso()))
    if engine is not None and SessionLocal is not None:
        try:
            async with SessionLocal() as db:
                db.add(ChatHistoryModel(chat_session_id=session_id, role="user", content=msg, meta=None))
                await db.commit()
        except Exception:
            logger.exception("ChatHistory persist failed for user message; continuing.")

    # Re-enrich context using the user question + anomaly topic, if we have a timestamp.
    anomaly = sess.anomaly_data or {}
    column = str(anomaly.get("column") or "").strip()
    ts = str(anomaly.get("timestamp") or "").strip()
    if column:
        q = f"{column} {msg}".strip()
        fresh = await get_news_context_cached(q, ts)
        if fresh:
            # Merge by link/title (best-effort).
            seen = set()
            merged: List[Dict[str, Any]] = []
            for a in (sess.articles or []) + fresh:
                key = (a.get("link") or "") + "|" + (a.get("title") or "")
                if not key.strip() or key in seen:
                    continue
                seen.add(key)
                merged.append(a)
            sess.articles = merged[:6]

    df = None
    if engine is not None and SessionLocal is not None and sess.analysis_session_id:
        try:
            from sqlalchemy import select

            async with SessionLocal() as db:
                arow = (
                    await db.execute(select(AnalysisSessionModel).where(AnalysisSessionModel.id == sess.analysis_session_id))
                ).scalar_one_or_none()
                if arow and arow.csv_text:
                    df = load_dataframe_from_csv_text(arow.csv_text)
        except Exception:
            df = None

    tool_events: List[Dict[str, Any]] = []
    if df is not None:
        reply, tool_events = await generate_chat_reply_agentic(
            anomaly_data=sess.anomaly_data,
            correlation_data=sess.correlation_data,
            articles=sess.articles,
            messages=[m.model_dump() for m in sess.messages],
            df=df,
            max_iters=3,
        )
    else:
        reply = await generate_chat_reply(
            anomaly_data=sess.anomaly_data,
            correlation_data=sess.correlation_data,
            articles=sess.articles,
            messages=[m.model_dump() for m in sess.messages],
        )

    # Insert tool call steps before the assistant reply.
    if tool_events:
        for ev in tool_events:
            name = str(ev.get("tool_name") or "tool")
            args = ev.get("args") or {}
            err = ev.get("error")
            content = (
                f"The Ghost is computing `{name}`..."
                if not err
                else f"The Ghost attempted `{name}` but encountered interference."
            )
            sess.messages.append(ChatMessage(role="tool", content=content, created_at=_now_iso(), meta=ev))

    sess.messages.append(ChatMessage(role="assistant", content=reply, created_at=_now_iso()))
    if engine is not None and SessionLocal is not None:
        try:
            async with SessionLocal() as db:
                # persist tool steps (audit trail)
                for ev in tool_events or []:
                    name = str(ev.get("tool_name") or "tool")
                    err = ev.get("error")
                    content = (
                        f"The Ghost is computing `{name}`..."
                        if not err
                        else f"The Ghost attempted `{name}` but encountered interference."
                    )
                    db.add(ChatHistoryModel(chat_session_id=session_id, role="tool", content=content, meta=ev))

                db.add(ChatHistoryModel(chat_session_id=session_id, role="assistant", content=reply, meta=None))
                # Keep latest merged articles on the chat session.
                from sqlalchemy import update
                await db.execute(update(ChatSessionModel).where(ChatSessionModel.id == session_id).values(articles=sess.articles))
                await db.commit()
        except Exception:
            logger.exception("ChatHistory persist failed for assistant/tool events; continuing.")
    return ChatSessionResponse(
        session_id=session_id,
        messages=sess.messages,
        articles=sess.articles or [],
        analysis_session_id=sess.analysis_session_id,
    )
