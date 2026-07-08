"""SQLAlchemy ORM models (persistence layer).

Kept intentionally separate from the Pydantic schemas in ``app.schemas`` so
the database shape is decoupled from LLM/API shapes.

Images are never stored as bytes here. For food photos we persist only a
lightweight reference (Telegram ``file_id`` / ``file_unique_id`` + metadata)
and re-fetch on demand; see ``docs`` in the plan for the R2/S3 upgrade path.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# JSONB on Postgres (production), portable JSON elsewhere (e.g. SQLite in tests).
JSONType = JSON().with_variant(JSONB(), "postgresql")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Telegram user id is the stable identity (see auth design).
    telegram_id: Mapped[int] = mapped_column(
        BigInteger, unique=True, index=True, nullable=False
    )
    username: Mapped[str | None] = mapped_column(String(255))
    first_name: Mapped[str | None] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")

    # Profile / goals
    goal_summary: Mapped[str | None] = mapped_column(Text)
    target_calories: Mapped[int | None] = mapped_column(Integer)
    target_protein_g: Mapped[int | None] = mapped_column(Integer)
    target_carbs_g: Mapped[int | None] = mapped_column(Integer)
    target_fat_g: Mapped[int | None] = mapped_column(Integer)

    # Proactive messaging preferences
    quiet_hours_start: Mapped[int | None] = mapped_column(Integer)  # local hour 0-23
    quiet_hours_end: Mapped[int | None] = mapped_column(Integer)
    nudges_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_nudge_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Learned bias between our portion estimates and this user's real portions
    # (1.0 = neutral). Nudged when the user says a logged meal was smaller/bigger.
    portion_multiplier: Mapped[float] = mapped_column(Float, default=1.0)

    # Compliance
    consent_health_data: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    goals: Mapped[list["Goal"]] = relationship(back_populates="user")
    meals: Mapped[list["Meal"]] = relationship(back_populates="user")
    workouts: Mapped[list["Workout"]] = relationship(back_populates="user")
    metrics: Mapped[list["Metric"]] = relationship(back_populates="user")


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(64))  # weight_loss, muscle_gain, ...
    target: Mapped[str | None] = mapped_column(String(255))
    target_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    user: Mapped[User] = relationship(back_populates="goals")


class Meal(Base):
    __tablename__ = "meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    source: Mapped[str] = mapped_column(String(16))  # "text" | "photo"
    meal_type: Mapped[str | None] = mapped_column(String(16))  # breakfast/lunch/...

    # Analysis (from MacroEstimate)
    description: Mapped[str | None] = mapped_column(Text)
    calories: Mapped[float] = mapped_column(Float, default=0)
    protein_g: Mapped[float] = mapped_column(Float, default=0)
    carbs_g: Mapped[float] = mapped_column(Float, default=0)
    fat_g: Mapped[float] = mapped_column(Float, default=0)
    confidence: Mapped[float | None] = mapped_column(Float)
    items_json: Mapped[list | None] = mapped_column(JSONType)

    # Image reference ONLY — no bytes stored.
    tg_file_id: Mapped[str | None] = mapped_column(String(512))
    tg_file_unique_id: Mapped[str | None] = mapped_column(String(255))
    photo_caption: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="meals")


class Workout(Base):
    __tablename__ = "workouts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    kind: Mapped[str] = mapped_column(String(64))  # strength, cardio, yoga, ...
    duration_min: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)

    user: Mapped[User] = relationship(back_populates="workouts")


class Metric(Base):
    __tablename__ = "metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    kind: Mapped[str] = mapped_column(String(32))  # weight, sleep, steps, ...
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(16))

    user: Mapped[User] = relationship(back_populates="metrics")


class PendingMeal(Base):
    """A photo meal awaiting the user's portion confirmation.

    One row per user (the latest photo). Cleared on confirm/skip or when it
    expires. Holds the serialized ``MacroEstimate`` so we can log deterministically
    without re-running vision when the user replies.
    """

    __tablename__ = "pending_meals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    estimate_json: Mapped[dict] = mapped_column(JSONType)
    # Multiplier already baked into estimate_json at analysis time (user bias).
    base_multiplier: Mapped[float] = mapped_column(Float, default=1.0)
    tg_file_id: Mapped[str | None] = mapped_column(String(512))
    tg_file_unique_id: Mapped[str | None] = mapped_column(String(255))
    photo_caption: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )


class Message(Base):
    """Raw message log for context/analytics (separate from LLM memory)."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, index=True
    )
    direction: Mapped[str] = mapped_column(String(8))  # "in" | "out"
    channel: Mapped[str] = mapped_column(String(32), default="telegram")
    content: Mapped[str | None] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text/photo/system
