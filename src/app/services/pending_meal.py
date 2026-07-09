"""Pending meal confirmation action tokens (stdlib only)."""
from __future__ import annotations

from app.config import settings


def action_factors() -> dict[str, float | None]:
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


def normalize_action(text: str) -> str | None:
    token = text.strip().lower()
    if token.startswith("meal:"):
        token = token.split(":", 1)[1]
        token = token.removeprefix("size_")
    return token if token in action_factors() else None
