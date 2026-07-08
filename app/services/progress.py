"""Aggregation helpers for progress summaries, reports and nudge decisions."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Meal, Metric, User, Workout
from app.schemas.nutrition import DailyTotals


def user_tz(user: User) -> ZoneInfo:
    try:
        return ZoneInfo(user.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def local_now(user: User) -> datetime:
    return datetime.now(user_tz(user))


def _day_bounds_utc(tz: ZoneInfo, day: date) -> tuple[datetime, datetime]:
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


async def daily_totals(
    session: AsyncSession, user: User, day: date | None = None
) -> DailyTotals:
    tz = user_tz(user)
    day = day or local_now(user).date()
    start_utc, end_utc = _day_bounds_utc(tz, day)

    meal_row = (
        await session.execute(
            select(
                func.coalesce(func.sum(Meal.calories), 0.0),
                func.coalesce(func.sum(Meal.protein_g), 0.0),
                func.coalesce(func.sum(Meal.carbs_g), 0.0),
                func.coalesce(func.sum(Meal.fat_g), 0.0),
                func.count(Meal.id),
            ).where(
                Meal.user_id == user.id,
                Meal.ts >= start_utc,
                Meal.ts < end_utc,
            )
        )
    ).one()

    workout_row = (
        await session.execute(
            select(
                func.count(Workout.id),
                func.coalesce(func.sum(Workout.duration_min), 0),
            ).where(
                Workout.user_id == user.id,
                Workout.ts >= start_utc,
                Workout.ts < end_utc,
            )
        )
    ).one()

    return DailyTotals(
        date=day.isoformat(),
        calories=float(meal_row[0]),
        protein_g=float(meal_row[1]),
        carbs_g=float(meal_row[2]),
        fat_g=float(meal_row[3]),
        meals=int(meal_row[4]),
        workouts=int(workout_row[0]),
        workout_minutes=int(workout_row[1] or 0),
        target_calories=user.target_calories,
        target_protein_g=user.target_protein_g,
        target_carbs_g=user.target_carbs_g,
        target_fat_g=user.target_fat_g,
    )


async def weekly_totals(
    session: AsyncSession, user: User, end_day: date | None = None
) -> list[DailyTotals]:
    end_day = end_day or local_now(user).date()
    days = [end_day - timedelta(days=i) for i in range(6, -1, -1)]
    return [await daily_totals(session, user, d) for d in days]


async def meals_logged_today(session: AsyncSession, user: User) -> int:
    return (await daily_totals(session, user)).meals


async def latest_weight(session: AsyncSession, user: User) -> float | None:
    row = (
        await session.execute(
            select(Metric.value)
            .where(Metric.user_id == user.id, Metric.kind == "weight")
            .order_by(Metric.ts.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return float(row) if row is not None else None


async def last_activity_at(session: AsyncSession, user: User) -> datetime | None:
    """Most recent meal or workout timestamp (for re-engagement)."""
    meal_ts = (
        await session.execute(
            select(func.max(Meal.ts)).where(Meal.user_id == user.id)
        )
    ).scalar_one_or_none()
    workout_ts = (
        await session.execute(
            select(func.max(Workout.ts)).where(Workout.user_id == user.id)
        )
    ).scalar_one_or_none()
    candidates = [t for t in (meal_ts, workout_ts) if t is not None]
    return max(candidates) if candidates else None
