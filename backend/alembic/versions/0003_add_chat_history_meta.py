"""add chat_history meta jsonb

Revision ID: 0003_add_chat_history_meta
Revises: 0002_add_csv_text
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_add_chat_history_meta"
down_revision = "0002_add_csv_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_history", sa.Column("meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_history", "meta")

