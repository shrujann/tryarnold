"""Application settings loaded from environment / .env.

Everything AI-related is optional so the service can boot (and its health
check pass) even without API keys — useful for local wiring and CI.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Core
    app_name: str = "telegram-fitness-coach"
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:8000"

    # Telegram
    telegram_bot_token: str | None = None
    telegram_webhook_secret: str = "change-me"

    # Database
    database_url: str = "postgresql+psycopg://coach:coach@localhost:5432/coach"
    database_url_sync: str = "postgresql+psycopg://coach:coach@localhost:5432/coach"

    # LLM / vision
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"
    openai_vision_model: str = "gpt-4o"

    # FatSecret (optional) — verified macro lookup after GPT identifies foods
    fatsecret_client_id: str | None = None
    fatsecret_client_secret: str | None = None

    # Proactive nudges
    nudge_poll_minutes: int = 15
    nudge_min_gap_hours: int = 3

    # Photo meal portion confirmation
    portion_confidence_threshold: float = 0.6  # below this, ask S/M/L first
    meal_confirm_max_calories: int = 1200  # above this, force the size picker
    pending_meal_ttl_minutes: int = 30
    portion_size_small: float = 0.7
    portion_size_large: float = 1.3

    @property
    def webhook_path(self) -> str:
        return "/telegram/webhook"

    @property
    def webhook_url(self) -> str:
        return f"{self.public_base_url.rstrip('/')}{self.webhook_path}"

    @property
    def ai_enabled(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def fatsecret_enabled(self) -> bool:
        return bool(self.fatsecret_client_id and self.fatsecret_client_secret)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
