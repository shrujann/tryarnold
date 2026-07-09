"""Minimal env settings for Cloudflare Workers Free (no pydantic)."""
from __future__ import annotations

import os
from functools import lru_cache


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value


class Settings:
    def __init__(self) -> None:
        self.app_name = _env("APP_NAME", "telegram-fitness-coach") or "telegram-fitness-coach"
        self.log_level = _env("LOG_LEVEL", "INFO") or "INFO"
        self.public_base_url = (
            _env("PUBLIC_BASE_URL", "http://localhost:8000") or "http://localhost:8000"
        )
        self.app_runtime = _env("APP_RUNTIME", "worker") or "worker"
        self.telegram_bot_token = _env("TELEGRAM_BOT_TOKEN")
        self.telegram_webhook_secret = (
            _env("TELEGRAM_WEBHOOK_SECRET", "change-me") or "change-me"
        )
        self.openai_api_key = _env("OPENAI_API_KEY")
        self.openai_model = _env("OPENAI_MODEL", "gpt-4o") or "gpt-4o"
        self.openai_vision_model = _env("OPENAI_VISION_MODEL", "gpt-4o") or "gpt-4o"
        self.portion_confidence_threshold = float(
            _env("PORTION_CONFIDENCE_THRESHOLD", "0.6") or "0.6"
        )
        self.meal_confirm_max_calories = int(
            _env("MEAL_CONFIRM_MAX_CALORIES", "1200") or "1200"
        )
        self.pending_meal_ttl_minutes = int(
            _env("PENDING_MEAL_TTL_MINUTES", "30") or "30"
        )
        self.portion_size_small = float(_env("PORTION_SIZE_SMALL", "0.7") or "0.7")
        self.portion_size_large = float(_env("PORTION_SIZE_LARGE", "1.3") or "1.3")

    @property
    def webhook_path(self) -> str:
        return "/telegram/webhook"

    @property
    def webhook_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}{self.webhook_path}"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openai_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


class _SettingsProxy:
    def __getattr__(self, name: str):
        return getattr(get_settings(), name)


settings = _SettingsProxy()
