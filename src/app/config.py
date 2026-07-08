"""Application settings for Cloudflare Workers + D1."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "telegram-fitness-coach"
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:8000"
    app_runtime: str = "worker"

    telegram_bot_token: str | None = None
    telegram_webhook_secret: str = "change-me"

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"
    openai_vision_model: str = "gpt-4o"

    # Portion confirmation thresholds (FatSecret is not used on Workers Free)
    portion_confidence_threshold: float = 0.6
    meal_confirm_max_calories: int = 1200
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


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
