"""User identity + profile services."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.base import InboundMessage
from app.db.models import User


async def get_by_telegram_id(session: AsyncSession, telegram_id: int) -> User | None:
    res = await session.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    return res.scalar_one_or_none()


async def get_by_id(session: AsyncSession, user_id: int) -> User | None:
    return await session.get(User, user_id)


async def get_or_create_from_inbound(
    session: AsyncSession, msg: InboundMessage
) -> tuple[User, bool]:
    """Return (user, created). First contact = implicit signup."""
    user = await get_by_telegram_id(session, msg.external_user_id)
    if user is not None:
        # Keep lightweight profile fields fresh.
        changed = False
        if msg.username and user.username != msg.username:
            user.username = msg.username
            changed = True
        if msg.first_name and user.first_name != msg.first_name:
            user.first_name = msg.first_name
            changed = True
        if changed:
            await session.flush()
        return user, False

    user = User(
        telegram_id=msg.external_user_id,
        username=msg.username,
        first_name=msg.first_name,
    )
    session.add(user)
    await session.flush()
    return user, True


async def update_profile(session: AsyncSession, user_id: int, **fields) -> User | None:
    user = await session.get(User, user_id)
    if user is None:
        return None
    allowed = {
        "goal_summary",
        "target_calories",
        "target_protein_g",
        "target_carbs_g",
        "target_fat_g",
        "timezone",
        "quiet_hours_start",
        "quiet_hours_end",
        "nudges_enabled",
        "consent_health_data",
        "onboarded",
    }
    for key, value in fields.items():
        if key in allowed and value is not None:
            setattr(user, key, value)
    await session.flush()
    return user


async def mark_nudged(session: AsyncSession, user_id: int) -> None:
    user = await session.get(User, user_id)
    if user is not None:
        user.last_nudge_at = datetime.now(timezone.utc)
        await session.flush()
