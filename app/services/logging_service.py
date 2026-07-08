"""Persistence helpers for meals, workouts, metrics and raw messages."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Goal, Meal, Message, Metric, Workout
from app.schemas.nutrition import MacroEstimate


async def log_message(
    session: AsyncSession,
    user_id: int,
    direction: str,
    content: str | None,
    kind: str = "text",
    channel: str = "telegram",
) -> Message:
    row = Message(
        user_id=user_id,
        direction=direction,
        content=content,
        kind=kind,
        channel=channel,
    )
    session.add(row)
    await session.flush()
    return row


async def log_meal(
    session: AsyncSession,
    user_id: int,
    *,
    source: str,
    estimate: MacroEstimate,
    meal_type: str | None = None,
    tg_file_id: str | None = None,
    tg_file_unique_id: str | None = None,
    photo_caption: str | None = None,
    ts: datetime | None = None,
) -> Meal:
    row = Meal(
        user_id=user_id,
        ts=ts or datetime.now(timezone.utc),
        source=source,
        meal_type=meal_type,
        description=estimate.description,
        calories=estimate.calories,
        protein_g=estimate.protein_g,
        carbs_g=estimate.carbs_g,
        fat_g=estimate.fat_g,
        confidence=estimate.confidence,
        items_json=[item.model_dump() for item in estimate.items],
        tg_file_id=tg_file_id,
        tg_file_unique_id=tg_file_unique_id,
        photo_caption=photo_caption,
    )
    session.add(row)
    await session.flush()
    return row


async def log_workout(
    session: AsyncSession,
    user_id: int,
    *,
    kind: str,
    duration_min: int | None = None,
    notes: str | None = None,
    ts: datetime | None = None,
) -> Workout:
    row = Workout(
        user_id=user_id,
        ts=ts or datetime.now(timezone.utc),
        kind=kind,
        duration_min=duration_min,
        notes=notes,
    )
    session.add(row)
    await session.flush()
    return row


async def log_metric(
    session: AsyncSession,
    user_id: int,
    *,
    kind: str,
    value: float,
    unit: str | None = None,
    ts: datetime | None = None,
) -> Metric:
    row = Metric(
        user_id=user_id,
        ts=ts or datetime.now(timezone.utc),
        kind=kind,
        value=value,
        unit=unit,
    )
    session.add(row)
    await session.flush()
    return row


async def add_goal(
    session: AsyncSession,
    user_id: int,
    *,
    kind: str,
    target: str | None = None,
    target_date: datetime | None = None,
) -> Goal:
    row = Goal(user_id=user_id, kind=kind, target=target, target_date=target_date)
    session.add(row)
    await session.flush()
    return row


async def get_last_meal(session: AsyncSession, user_id: int) -> Meal | None:
    result = await session.execute(
        select(Meal)
        .where(Meal.user_id == user_id)
        .order_by(Meal.ts.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
