"""Builds the compact per-user context string injected into the system prompt."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.services import progress


async def build_user_context(session: AsyncSession, user: User) -> str:
    now_local = progress.local_now(user)
    totals = await progress.daily_totals(session, user)

    lines = [
        f"- Name: {user.first_name or 'unknown'}",
        f"- Onboarded: {user.onboarded}",
        f"- Health-data consent: {user.consent_health_data}",
        f"- Timezone: {user.timezone} (their local time now: {now_local:%A %H:%M})",
    ]
    if user.goal_summary:
        lines.append(f"- Goal: {user.goal_summary}")
    if user.target_calories:
        lines.append(
            f"- Daily targets: {user.target_calories} kcal, "
            f"P{user.target_protein_g or '?'} C{user.target_carbs_g or '?'} "
            f"F{user.target_fat_g or '?'}"
        )
    lines.append(
        f"- Logged today: {round(totals.calories)} kcal across {totals.meals} "
        f"meal(s), {totals.workouts} workout(s)."
    )
    return "\n".join(lines)
