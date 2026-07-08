"""FastAPI entrypoint: webhook, lifecycle, health + admin endpoints."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request

from app.agent.graph import build_agent
from app.agent.memory import memory_manager
from app.channels.telegram import TelegramChannel
from app.config import settings
from app.db.base import engine
from app.logging_config import configure_logging, get_logger
from app.orchestrator import handle_inbound
from app.scheduler.proactive import ProactiveScheduler

configure_logging()
log = get_logger(__name__)

channel = TelegramChannel()
scheduler: ProactiveScheduler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler
    log.info("Starting %s", settings.app_name)

    await memory_manager.setup()
    build_agent()

    if channel.enabled:
        # A Telegram connectivity/token problem must NOT crash startup — the
        # service should still boot (health check, admin endpoints) so it can be
        # fixed and the webhook (re)registered without a redeploy.
        try:
            await channel.initialize()
            # Auto-register webhook only for public HTTPS URLs.
            if settings.public_base_url.startswith("https://"):
                ok = await channel.set_webhook()
                log.info("Webhook set: %s (%s)", ok, settings.webhook_url)
            else:
                log.info(
                    "PUBLIC_BASE_URL is not HTTPS; skipping auto webhook. "
                    "Use POST /admin/set-webhook once you have a public URL."
                )
        except Exception:
            log.exception(
                "Telegram initialization failed; continuing WITHOUT live "
                "Telegram transport. Check TELEGRAM_BOT_TOKEN and that the host "
                "can reach api.telegram.org, then POST /admin/set-webhook."
            )
    else:
        log.warning("TELEGRAM_BOT_TOKEN not set; running without Telegram transport")

    scheduler = ProactiveScheduler(channel)
    if channel.enabled:
        scheduler.start()

    try:
        yield
    finally:
        log.info("Shutting down")
        if scheduler is not None:
            scheduler.shutdown()
        await memory_manager.teardown()
        await channel.shutdown()
        await engine.dispose()


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    return {
        "status": "ok",
        "app": settings.app_name,
        "ai_enabled": settings.ai_enabled,
        "fatsecret_enabled": settings.fatsecret_enabled,
        "memory_backend": memory_manager.backend,
        "telegram_enabled": channel.enabled,
    }


async def _process_update(update: dict) -> None:
    try:
        msg = channel.parse_update(update)
        if msg is not None:
            await handle_inbound(channel, msg)
    except Exception:
        log.exception("Error processing update")


@app.post(settings.webhook_path)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
):
    # Trust boundary: verify the request actually came from Telegram.
    if x_telegram_bot_api_secret_token != settings.telegram_webhook_secret:
        raise HTTPException(status_code=403, detail="invalid secret token")

    update = await request.json()
    # Ack immediately; process in the background so slow LLM calls don't cause
    # Telegram to retry the webhook.
    asyncio.create_task(_process_update(update))
    return {"ok": True}


@app.post("/admin/set-webhook")
async def admin_set_webhook():
    if not channel.enabled:
        raise HTTPException(400, "Telegram not configured")
    try:
        ok = await channel.set_webhook()
    except Exception as exc:  # e.g. cannot reach api.telegram.org
        raise HTTPException(502, f"Telegram unreachable: {exc}") from exc
    return {"ok": ok, "url": settings.webhook_url}


@app.post("/admin/delete-webhook")
async def admin_delete_webhook():
    if not channel.enabled:
        raise HTTPException(400, "Telegram not configured")
    ok = await channel.delete_webhook()
    return {"ok": ok}
