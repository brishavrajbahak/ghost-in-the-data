"""add csv_text

Revision ID: 0002_add_csv_text
Revises: 0001_init
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_add_csv_text"
down_revision = "0001_init"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analysis_sessions", sa.Column("csv_text", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("analysis_sessions", "csv_text")

