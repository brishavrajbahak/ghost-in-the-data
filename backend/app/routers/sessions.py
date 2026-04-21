from fastapi import APIRouter, HTTPException
from typing import Any, Dict, List, Optional

from sqlalchemy import desc, func, select

from app.db import engine, get_db
from app.models.db_models import AnalysisSession, ChatHistory, ChatSession

router = APIRouter()


@router.get("/sessions")
async def list_sessions(limit: int = 20):
    if engine is None:
        return []

    limit = max(1, min(int(limit), 50))
    async for db in get_db():
        rows = (
            await db.execute(
                select(
                    AnalysisSession.id,
                    AnalysisSession.created_at,
                    AnalysisSession.filename,
                    AnalysisSession.analysis_metadata,
                    func.jsonb_array_length(AnalysisSession.anomalies).label("anomaly_count"),
                )
                .order_by(desc(AnalysisSession.created_at))
                .limit(limit)
            )
        ).all()

        return [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "filename": r.filename,
                "anomaly_count": int(r.anomaly_count or 0),
                "time_span": (r.analysis_metadata or {}).get("time_span"),
                "timestamp_col": (r.analysis_metadata or {}).get("timestamp_col"),
            }
            for r in rows
        ]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    if engine is None:
        raise HTTPException(status_code=400, detail="Persistence is not configured")

    async for db in get_db():
        row = (await db.execute(select(AnalysisSession).where(AnalysisSession.id == session_id))).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Not found")
        return {
            "id": row.id,
            "created_at": row.created_at.isoformat(),
            "filename": row.filename,
            "metadata": row.analysis_metadata,
            "anomalies": row.anomalies,
            "correlations": row.correlations,
            "csv_text": row.csv_text,
        }


@router.get("/sessions/{session_id}/chats")
async def list_chats_for_session(session_id: str, limit: int = 50):
    if engine is None:
        raise HTTPException(status_code=400, detail="Persistence is not configured")

    limit = max(1, min(int(limit), 200))
    async for db in get_db():
        rows = (
            await db.execute(
                select(
                    ChatSession.id,
                    ChatSession.created_at,
                    ChatSession.anomaly_index,
                    func.max(ChatHistory.created_at).label("last_message_at"),
                    func.count(ChatHistory.id).label("message_count"),
                )
                .join(ChatHistory, ChatHistory.chat_session_id == ChatSession.id)
                .where(ChatSession.analysis_session_id == session_id)
                .group_by(ChatSession.id)
                .order_by(desc(func.max(ChatHistory.created_at)))
                .limit(limit)
            )
        ).all()

        return [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "anomaly_index": r.anomaly_index,
                "last_message_at": r.last_message_at.isoformat() if r.last_message_at else None,
                "message_count": int(r.message_count or 0),
            }
            for r in rows
        ]


@router.get("/chats/{chat_session_id}")
async def get_chat(chat_session_id: str):
    if engine is None:
        raise HTTPException(status_code=400, detail="Persistence is not configured")

    async for db in get_db():
        chat = (await db.execute(select(ChatSession).where(ChatSession.id == chat_session_id))).scalar_one_or_none()
        if not chat:
            raise HTTPException(status_code=404, detail="Not found")

        msgs = (
            await db.execute(
                select(ChatHistory).where(ChatHistory.chat_session_id == chat_session_id).order_by(ChatHistory.id.asc())
            )
        ).scalars().all()

        return {
            "id": chat.id,
            "created_at": chat.created_at.isoformat(),
            "analysis_session_id": chat.analysis_session_id,
            "anomaly_index": chat.anomaly_index,
            "anomaly_data": chat.anomaly_data,
            "correlation_data": chat.correlation_data,
            "articles": chat.articles,
            "messages": [
                {
                    "role": m.role,
                    "content": m.content,
                    "created_at": m.created_at.isoformat(),
                    "meta": getattr(m, "meta", None),
                }
                for m in msgs
            ],
        }
