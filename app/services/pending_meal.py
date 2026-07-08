"""Pending photo-meal confirmation state.

A food photo is analyzed, stashed here, and only written to the meals table
once the user confirms the portion (Log / Smaller / Bigger / S / M / L) or is
discarded on Skip. Keeping one pending row per user means a new photo replaces
any stale one.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.models import PendingMeal
from app.schemas.nutrition import MacroEstimate
from app.services import logging_service, users


# Confirmation actions mapped to a portion factor applied to the stored estimate.
# ``None`` factor means "do not log".
def _action_factors() -> dict[str, float | None]:
    small = settings.portion_size_small
    large = settings.portion_size_large
    return {
        "log": 1.0,
        "yes": 1.0,
        "ok": 1.0,
        "medium": 1.0,
        "m": 1.0,
        "smaller": small,
        "small": small,
        "s": small,
        "bigger": large,
        "large": large,
        "l": large,
        "skip": None,
    }


CONFIRM_TOKENS = frozenset(_action_factors().keys())


@dataclass
class ConfirmResult:
    status: str  # "logged" | "skipped" | "expired" | "unknown"
    estimate: MacroEstimate | None = None


def normalize_action(text: str) -> str | None:
    """Map a free-text reply or callback payload to a known action, or None."""
    token = text.strip().lower()
    if token.startswith("meal:"):
        token = token.split(":", 1)[1]
        # Callback size buttons come through as size_s / size_m / size_l.
        token = token.removeprefix("size_")
    return token if token in CONFIRM_TOKENS else None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


async def save_pending(
    session: AsyncSession,
    user_id: int,
    *,
    estimate: MacroEstimate,
    base_multiplier: float,
    tg_file_id: str | None,
    tg_file_unique_id: str | None,
    photo_caption: str | None,
) -> None:
    await session.execute(
        delete(PendingMeal).where(PendingMeal.user_id == user_id)
    )
    session.add(
        PendingMeal(
            user_id=user_id,
            estimate_json=estimate.model_dump(),
            base_multiplier=base_multiplier,
            tg_file_id=tg_file_id,
            tg_file_unique_id=tg_file_unique_id,
            photo_caption=photo_caption,
            created_at=datetime.now(timezone.utc),
        )
    )
    await session.flush()


async def get_pending(session: AsyncSession, user_id: int) -> PendingMeal | None:
    res = await session.execute(
        select(PendingMeal).where(PendingMeal.user_id == user_id)
    )
    return res.scalar_one_or_none()


async def has_pending(session: AsyncSession, user_id: int) -> bool:
    return (await get_pending(session, user_id)) is not None


async def clear_pending(session: AsyncSession, user_id: int) -> None:
    await session.execute(
        delete(PendingMeal).where(PendingMeal.user_id == user_id)
    )
    await session.flush()


def _is_expired(pending: PendingMeal) -> bool:
    created = pending.created_at
    if created is None:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    ttl = timedelta(minutes=settings.pending_meal_ttl_minutes)
    return datetime.now(timezone.utc) - created > ttl


async def confirm(
    session: AsyncSession, user_id: int, action: str
) -> ConfirmResult:
    """Resolve a pending meal for ``action`` and log it (unless skipped)."""
    pending = await get_pending(session, user_id)
    if pending is None:
        return ConfirmResult(status="unknown")

    if _is_expired(pending):
        await clear_pending(session, user_id)
        return ConfirmResult(status="expired")

    factor = _action_factors().get(action)
    if factor is None:
        await clear_pending(session, user_id)
        return ConfirmResult(status="skipped")

    estimate = MacroEstimate.model_validate(pending.estimate_json)
    if factor != 1.0:
        estimate = estimate.apply_multiplier(factor)

    await logging_service.log_meal(
        session,
        user_id,
        source="photo",
        estimate=estimate,
        tg_file_id=pending.tg_file_id,
        tg_file_unique_id=pending.tg_file_unique_id,
        photo_caption=pending.photo_caption,
    )

    if factor != 1.0:
        await _learn_bias(session, user_id, factor)

    await clear_pending(session, user_id)
    return ConfirmResult(status="logged", estimate=estimate)


async def _learn_bias(session: AsyncSession, user_id: int, factor: float) -> None:
    """Nudge the user's portion_multiplier toward their correction (gentle EMA)."""
    user = await users.get_by_id(session, user_id)
    if user is None:
        return
    alpha = 0.5  # move halfway (in log space) toward the correction
    updated = _clamp((user.portion_multiplier or 1.0) * (factor ** alpha), 0.6, 1.4)
    user.portion_multiplier = round(updated, 3)
    await session.flush()
