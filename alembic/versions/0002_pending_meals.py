"""pending meals + user portion multiplier

Revision ID: 0002_pending_meals
Revises: 0001_initial
Create Date: 2026-07-07
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_pending_meals"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "portion_multiplier", sa.Float(), server_default="1.0", nullable=False
        ),
    )

    op.create_table(
        "pending_meals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("estimate_json", postgresql.JSONB()),
        sa.Column("base_multiplier", sa.Float(), server_default="1.0"),
        sa.Column("tg_file_id", sa.String(length=512)),
        sa.Column("tg_file_unique_id", sa.String(length=255)),
        sa.Column("photo_caption", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )
    op.create_index(
        "ix_pending_meals_user_id", "pending_meals", ["user_id"], unique=True
    )


def downgrade() -> None:
    op.drop_table("pending_meals")
    op.drop_column("users", "portion_multiplier")
