"""Tools the coach agent can call.

The current user's id is injected via the runnable config (``configurable.
user_id``) so it is never exposed to / hallucinated by the LLM. Each tool opens
its own short transactional DB session.
"""
from __future__ import annotations

from datetime import datetime

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.db.base import session_scope
from app.logging_config import get_logger
from app.schemas.nutrition import MacroEstimate
from app.services import logging_service, progress, users
from app.vision import food

log = get_logger(__name__)


def _user_id(config: RunnableConfig | None) -> int:
    if not config:
        raise ValueError("Missing runtime config")
    uid = (config.get("configurable") or {}).get("user_id")
    if uid is None:
        raise ValueError("Missing user_id in config")
    return int(uid)


@tool
async def update_profile(
    config: RunnableConfig,
    goal_summary: str | None = None,
    target_calories: int | None = None,
    target_protein_g: int | None = None,
    target_carbs_g: int | None = None,
    target_fat_g: int | None = None,
    timezone: str | None = None,
    quiet_hours_start: int | None = None,
    quiet_hours_end: int | None = None,
    consent_health_data: bool | None = None,
    onboarded: bool | None = None,
) -> str:
    """Update the user's profile: goal summary, daily macro targets, timezone
    (IANA name like 'Europe/London'), quiet hours (local hours 0-23), health-data
    consent, and onboarding completion. Only pass fields you want to change."""
    async with session_scope() as session:
        user = await users.update_profile(
            session,
            _user_id(config),
            goal_summary=goal_summary,
            target_calories=target_calories,
            target_protein_g=target_protein_g,
            target_carbs_g=target_carbs_g,
            target_fat_g=target_fat_g,
            timezone=timezone,
            quiet_hours_start=quiet_hours_start,
            quiet_hours_end=quiet_hours_end,
            consent_health_data=consent_health_data,
            onboarded=onboarded,
        )
        if user is None:
            return "error: profile not found"
    return "profile_updated"


@tool
async def set_goal(
    config: RunnableConfig,
    kind: str,
    target: str | None = None,
    target_date: str | None = None,
) -> str:
    """Record a specific fitness goal. kind is a short slug like 'weight_loss',
    'muscle_gain', 'endurance'. target is a free-text target (e.g. 'lose 5kg').
    target_date is an optional ISO date (YYYY-MM-DD)."""
    parsed_date = None
    if target_date:
        try:
            parsed_date = datetime.fromisoformat(target_date)
        except ValueError:
            parsed_date = None
    async with session_scope() as session:
        await logging_service.add_goal(
            session, _user_id(config), kind=kind, target=target, target_date=parsed_date
        )
    return f"goal_saved: {kind}" + (f" ({target})" if target else "")


@tool
async def log_meal(
    config: RunnableConfig,
    description: str,
    calories: float = 0,
    protein_g: float = 0,
    carbs_g: float = 0,
    fat_g: float = 0,
    meal_type: str | None = None,
    tg_file_id: str | None = None,
    tg_file_unique_id: str | None = None,
    confidence: float | None = None,
) -> str:
    """Log a meal. Provide a short description and, if you know them, the macro
    totals. If calories is 0/omitted for a text description, macros will be
    estimated automatically. meal_type is breakfast/lunch/dinner/snack. Pass
    tg_file_id/tg_file_unique_id when logging from a food photo so it can be
    recalled later."""
    if calories <= 0 and description:
        estimate = await food.estimate_from_text(description)
    else:
        estimate = MacroEstimate(
            description=description,
            calories=calories,
            protein_g=protein_g,
            carbs_g=carbs_g,
            fat_g=fat_g,
            confidence=confidence if confidence is not None else 0.7,
        )
    source = "photo" if tg_file_id else "text"
    async with session_scope() as session:
        await logging_service.log_meal(
            session,
            _user_id(config),
            source=source,
            estimate=estimate,
            meal_type=meal_type,
            tg_file_id=tg_file_id,
            tg_file_unique_id=tg_file_unique_id,
        )
    return f"meal_logged: {estimate.description or 'meal'}, {estimate.totals_line()}"


@tool
async def log_workout(
    config: RunnableConfig,
    kind: str,
    duration_min: int | None = None,
    notes: str | None = None,
) -> str:
    """Log a workout. kind is a short label (e.g. 'strength', 'run', 'yoga').
    duration_min is minutes if known."""
    async with session_scope() as session:
        await logging_service.log_workout(
            session, _user_id(config), kind=kind, duration_min=duration_min, notes=notes
        )
    mins = f", {duration_min} min" if duration_min else ""
    return f"workout_logged: {kind}{mins}"


@tool
async def log_metric(
    config: RunnableConfig,
    kind: str,
    value: float,
    unit: str | None = None,
) -> str:
    """Log a body/health metric. kind is 'weight', 'sleep', 'steps', etc.
    Include a unit like 'kg', 'lb', 'hours' where relevant."""
    async with session_scope() as session:
        await logging_service.log_metric(
            session, _user_id(config), kind=kind, value=value, unit=unit
        )
    return f"metric_logged: {kind}={value}{(' ' + unit) if unit else ''}"


@tool
async def get_progress(config: RunnableConfig, period: str = "today") -> str:
    """Get the user's nutrition/activity summary. period is 'today' or 'week'."""
    async with session_scope() as session:
        user = await users.get_by_id(session, _user_id(config))
        if user is None:
            return "error: profile not found"
        if period == "week":
            week = await progress.weekly_totals(session, user)
            lines = [
                f"{d.date}: {round(d.calories)} kcal, P{round(d.protein_g)} "
                f"C{round(d.carbs_g)} F{round(d.fat_g)}, {d.workouts} workout(s)"
                for d in week
            ]
            return "week:\n" + "\n".join(lines)
        totals = await progress.daily_totals(session, user)
    target = (
        f" / {totals.target_calories} target"
        if totals.target_calories
        else ""
    )
    return (
        f"today: {round(totals.calories)} kcal{target}, "
        f"P{round(totals.protein_g)}g C{round(totals.carbs_g)}g F{round(totals.fat_g)}g, "
        f"{totals.meals} meal(s), {totals.workouts} workout(s), "
        f"{totals.workout_minutes} min"
    )


def all_tools() -> list:
    return [
        update_profile,
        set_goal,
        log_meal,
        log_workout,
        log_metric,
        get_progress,
    ]
