"""init

Revision ID: 0001_init
Revises: 
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "analysis_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("anomalies", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("correlations", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )

    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("analysis_session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("analysis_sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("anomaly_index", sa.Integer(), nullable=True),
        sa.Column("anomaly_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("correlation_data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("articles", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )

    op.create_table(
        "chat_history",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("chat_session_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
    )
    op.create_index("ix_chat_history_chat_session_id", "chat_history", ["chat_session_id"])


def downgrade():
    op.drop_index("ix_chat_history_chat_session_id", table_name="chat_history")
    op.drop_table("chat_history")
    op.drop_table("chat_sessions")
    op.drop_table("analysis_sessions")

