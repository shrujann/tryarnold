"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-06
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("telegram_id", sa.BigInteger(), nullable=False),
        sa.Column("username", sa.String(length=255)),
        sa.Column("first_name", sa.String(length=255)),
        sa.Column("timezone", sa.String(length=64), server_default="UTC"),
        sa.Column("goal_summary", sa.Text()),
        sa.Column("target_calories", sa.Integer()),
        sa.Column("target_protein_g", sa.Integer()),
        sa.Column("target_carbs_g", sa.Integer()),
        sa.Column("target_fat_g", sa.Integer()),
        sa.Column("quiet_hours_start", sa.Integer()),
        sa.Column("quiet_hours_end", sa.Integer()),
        sa.Column("nudges_enabled", sa.Boolean(), server_default=sa.true()),
        sa.Column("last_nudge_at", sa.DateTime(timezone=True)),
        sa.Column("consent_health_data", sa.Boolean(), server_default=sa.false()),
        sa.Column("phone_verified", sa.Boolean(), server_default=sa.false()),
        sa.Column("onboarded", sa.Boolean(), server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_users_telegram_id", "users", ["telegram_id"], unique=True)

    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("kind", sa.String(length=64)),
        sa.Column("target", sa.String(length=255)),
        sa.Column("target_date", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(length=32), server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_goals_user_id", "goals", ["user_id"])

    op.create_table(
        "meals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("ts", sa.DateTime(timezone=True)),
        sa.Column("source", sa.String(length=16)),
        sa.Column("meal_type", sa.String(length=16)),
        sa.Column("description", sa.Text()),
        sa.Column("calories", sa.Float(), server_default="0"),
        sa.Column("protein_g", sa.Float(), server_default="0"),
        sa.Column("carbs_g", sa.Float(), server_default="0"),
        sa.Column("fat_g", sa.Float(), server_default="0"),
        sa.Column("confidence", sa.Float()),
        sa.Column("items_json", postgresql.JSONB()),
        sa.Column("tg_file_id", sa.String(length=512)),
        sa.Column("tg_file_unique_id", sa.String(length=255)),
        sa.Column("photo_caption", sa.Text()),
    )
    op.create_index("ix_meals_user_id", "meals", ["user_id"])
    op.create_index("ix_meals_ts", "meals", ["ts"])

    op.create_table(
        "workouts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("ts", sa.DateTime(timezone=True)),
        sa.Column("kind", sa.String(length=64)),
        sa.Column("duration_min", sa.Integer()),
        sa.Column("notes", sa.Text()),
    )
    op.create_index("ix_workouts_user_id", "workouts", ["user_id"])
    op.create_index("ix_workouts_ts", "workouts", ["ts"])

    op.create_table(
        "metrics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("ts", sa.DateTime(timezone=True)),
        sa.Column("kind", sa.String(length=32)),
        sa.Column("value", sa.Float()),
        sa.Column("unit", sa.String(length=16)),
    )
    op.create_index("ix_metrics_user_id", "metrics", ["user_id"])
    op.create_index("ix_metrics_ts", "metrics", ["ts"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("ts", sa.DateTime(timezone=True)),
        sa.Column("direction", sa.String(length=8)),
        sa.Column("channel", sa.String(length=32), server_default="telegram"),
        sa.Column("content", sa.Text()),
        sa.Column("kind", sa.String(length=16), server_default="text"),
    )
    op.create_index("ix_messages_user_id", "messages", ["user_id"])
    op.create_index("ix_messages_ts", "messages", ["ts"])


def downgrade() -> None:
    for table in ["messages", "metrics", "workouts", "meals", "goals", "users"]:
        op.drop_table(table)
