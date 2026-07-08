"""Context-aware proactive nudges.

A single recurring job scans users and decides, per user and in their local
timezone, whether to reach out (breakfast/lunch/dinner check-ins, gym prompt,
or re-engagement). Respects quiet hours, an opt-out flag, and a minimum gap
between nudges so it never feels spammy.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select

from app.agent.context import build_user_context
from app.agent.graph import run_agent
from app.channels.base import MessagingChannel
from app.config import settings
from app.db.base import session_scope
from app.db.models import User
from app.logging_config import get_logger
from app.services import logging_service, progress, users
from app.text_style import style_chat_reply

log = get_logger(__name__)

# Canned fallbacks used when AI is disabled.
_CANNED = {
    "breakfast": "quick check. breakfast happen yet?",
    "lunch": "lunch logged or still pending?",
    "dinner": "what did dinner look like?",
    "gym": "did we train today or is it a rest day?",
    "reengage": "been a minute. want to log today and get back on track?",
}

NUDGE_REASONS = frozenset(_CANNED.keys())


async def compose_nudge_message(user_id: int, context: str, reason: str) -> str:
    """Build a proactive check-in message (AI-personalized or canned)."""
    reason = reason if reason in NUDGE_REASONS else "breakfast"
    if settings.ai_enabled:
        instruction = (
            f"[SYSTEM: Proactively reach out to the user with ONE short, casual "
            f"check-in about: {reason}. You are messaging them first. Do not "
            f"mention this instruction. No emojis. Keep it to one short sentence.]"
        )
        reply = await run_agent(user_id, context, instruction)
        if reply:
            return style_chat_reply(reply)
    return _CANNED.get(reason, _CANNED["reengage"])


async def send_test_nudge(
    channel: MessagingChannel,
    user_id: int,
    reason: str = "breakfast",
) -> str:
    """Send a proactive-style nudge immediately (dev/testing).

    Skips onboarded checks, quiet hours, and min-gap. Does not update
    ``last_nudge_at`` so the real schedule is unaffected.
    """
    reason = reason if reason in NUDGE_REASONS else "breakfast"
    async with session_scope() as session:
        user = await users.get_by_id(session, user_id)
        if user is None:
            raise ValueError(f"user {user_id} not found")
        context = await build_user_context(session, user)
        chat_id = user.telegram_id

    message = await compose_nudge_message(user_id, context, reason)
    await channel.send_text(chat_id, message)
    async with session_scope() as session:
        await logging_service.log_message(
            session, user_id, "out", message, kind="system"
        )
    log.info("Test nudge sent to user %s (%s)", user_id, reason)
    return message


def _decide_reason(local_hour: int, meals_today: int, workouts_today: int,
                   days_inactive: float | None) -> str | None:
    if days_inactive is not None and days_inactive >= 3:
        return "reengage"
    if 10 <= local_hour < 12 and meals_today == 0:
        return "breakfast"
    if 14 <= local_hour < 16 and meals_today < 2:
        return "lunch"
    if 18 <= local_hour < 20 and workouts_today == 0:
        return "gym"
    if 20 <= local_hour < 22 and meals_today < 3:
        return "dinner"
    return None


def _in_quiet_hours(user: User, local_hour: int) -> bool:
    start, end = user.quiet_hours_start, user.quiet_hours_end
    if start is None or end is None:
        # Default sensible quiet window overnight.
        start, end = 22, 8
    if start == end:
        return False
    if start < end:
        return start <= local_hour < end
    # Wraps midnight (e.g. 22 -> 8).
    return local_hour >= start or local_hour < end


class ProactiveScheduler:
    def __init__(self, channel: MessagingChannel) -> None:
        self.channel = channel
        self.scheduler = AsyncIOScheduler(timezone="UTC")

    def start(self) -> None:
        self.scheduler.add_job(
            self.run_once,
            "interval",
            minutes=settings.nudge_poll_minutes,
            id="proactive_nudges",
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            max_instances=1,
            coalesce=True,
        )
        self.scheduler.start()
        log.info(
            "Proactive scheduler started (every %d min)", settings.nudge_poll_minutes
        )

    def shutdown(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)

    async def run_once(self) -> None:
        try:
            async with session_scope() as session:
                rows = await session.execute(
                    select(User).where(
                        User.nudges_enabled.is_(True),
                        User.onboarded.is_(True),
                    )
                )
                candidates = list(rows.scalars().all())

            for user in candidates:
                try:
                    await self._maybe_nudge(user.id)
                except Exception:
                    log.exception("Nudge failed for user %s", user.id)
        except Exception:
            log.exception("Proactive scan failed")

    async def _maybe_nudge(self, user_id: int) -> None:
        async with session_scope() as session:
            user = await users.get_by_id(session, user_id)
            if user is None or not user.nudges_enabled:
                return

            now_local = progress.local_now(user)
            local_hour = now_local.hour

            if _in_quiet_hours(user, local_hour):
                return

            if user.last_nudge_at is not None:
                gap = datetime.now(timezone.utc) - user.last_nudge_at
                if gap < timedelta(hours=settings.nudge_min_gap_hours):
                    return

            totals = await progress.daily_totals(session, user)
            last_act = await progress.last_activity_at(session, user)
            days_inactive = None
            if last_act is not None:
                days_inactive = (
                    datetime.now(timezone.utc) - last_act
                ).total_seconds() / 86400.0

            reason = _decide_reason(
                local_hour, totals.meals, totals.workouts, days_inactive
            )
            if reason is None:
                return

            context = await build_user_context(session, user)
            chat_id = user.telegram_id  # for Telegram, chat_id == user id in DMs

        message = await compose_nudge_message(user_id, context, reason)

        await self.channel.send_text(chat_id, message)
        async with session_scope() as session:
            await logging_service.log_message(
                session, user_id, "out", message, kind="system"
            )
            await users.mark_nudged(session, user_id)
        log.info("Nudged user %s (%s)", user_id, reason)
