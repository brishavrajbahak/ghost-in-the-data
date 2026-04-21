from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class AnalysisSession(Base):
    __tablename__ = "analysis_sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    analysis_metadata: Mapped[Dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    anomalies: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    correlations: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    csv_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    chats: Mapped[List["ChatSession"]] = relationship(back_populates="analysis_session")


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    analysis_session_id: Mapped[Optional[str]] = mapped_column(
        UUID(as_uuid=False), ForeignKey("analysis_sessions.id", ondelete="SET NULL"), nullable=True
    )
    anomaly_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    anomaly_data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    correlation_data: Mapped[List[str]] = mapped_column(JSONB, nullable=False, default=list)
    articles: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    analysis_session: Mapped[Optional[AnalysisSession]] = relationship(back_populates="chats")
    messages: Mapped[List["ChatHistory"]] = relationship(back_populates="chat_session", cascade="all, delete-orphan")


class ChatHistory(Base):
    __tablename__ = "chat_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_session_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)

    chat_session: Mapped[ChatSession] = relationship(back_populates="messages")
