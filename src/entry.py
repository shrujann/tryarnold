from __future__ import annotations

import json
import os
from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint

from app.runtime import bind_worker_env


def _bootstrap_env(env) -> None:
    os.environ["APP_RUNTIME"] = "worker"
    for key in (
        "APP_NAME",
        "LOG_LEVEL",
        "PUBLIC_BASE_URL",
        "TELEGRAM_BOT_TOKEN",
        "TELEGRAM_WEBHOOK_SECRET",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_VISION_MODEL",
        "PORTION_CONFIDENCE_THRESHOLD",
        "MEAL_CONFIRM_MAX_CALORIES",
        "PENDING_MEAL_TTL_MINUTES",
        "PORTION_SIZE_SMALL",
        "PORTION_SIZE_LARGE",
    ):
        value = getattr(env, key, None)
        if value is not None:
            os.environ[key] = str(value)


def _json_response(data: dict, status: int = 200) -> Response:
    return Response(
        json.dumps(data),
        status=status,
        headers={"content-type": "application/json"},
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        _bootstrap_env(self.env)
        with bind_worker_env(self.env):
            try:
                url = urlparse(str(request.url))
                path = url.path
                method = str(request.method).upper()

                if path == "/favicon.ico":
                    return Response("", status=204)

                if method == "GET" and path == "/healthz":
                    return _json_response(
                        {
                            "status": "ok",
                            "app": os.environ.get(
                                "APP_NAME", "telegram-fitness-coach"
                            ),
                            "ai_enabled": bool(
                                getattr(self.env, "OPENAI_API_KEY", None)
                            ),
                            "fatsecret_enabled": False,
                            "memory_backend": "d1-context",
                            "telegram_enabled": bool(
                                getattr(self.env, "TELEGRAM_BOT_TOKEN", None)
                            ),
                            "runtime": "worker",
                        }
                    )

                if method == "POST" and path == "/telegram/webhook/ping":
                    return _json_response({"ok": True, "ping": True})

                if method == "POST" and path == "/telegram/webhook":
                    raw_secret = request.headers.get(
                        "x-telegram-bot-api-secret-token"
                    )
                    secret = "" if raw_secret is None else str(raw_secret)
                    expected = str(
                        getattr(self.env, "TELEGRAM_WEBHOOK_SECRET", None)
                        or os.environ.get("TELEGRAM_WEBHOOK_SECRET")
                        or "change-me"
                    )
                    if secret != expected:
                        return _json_response(
                            {"detail": "invalid secret token"}, status=403
                        )

                    update = await request.json()
                    from app.worker_app import process_update, sync_settings

                    sync_settings()
                    # Process inline: waitUntil + ContextVar loses D1 binding in
                    # Python Workers. Network wait does not count against Free CPU.
                    try:
                        await process_update(update)
                    except Exception as exc:
                        return _json_response(
                            {
                                "ok": False,
                                "error": type(exc).__name__,
                                "detail": str(exc),
                            },
                            status=500,
                        )
                    return _json_response({"ok": True})

                if method == "POST" and path == "/admin/set-webhook":
                    try:
                        from app.worker_app import set_webhook, sync_settings

                        sync_settings()
                        return _json_response(await set_webhook())
                    except Exception as exc:
                        return _json_response(
                            {"detail": str(exc), "error": type(exc).__name__},
                            status=502,
                        )

                if method == "POST" and path == "/admin/delete-webhook":
                    try:
                        from app.worker_app import delete_webhook, sync_settings

                        sync_settings()
                        return _json_response(await delete_webhook())
                    except Exception as exc:
                        return _json_response(
                            {"detail": str(exc), "error": type(exc).__name__},
                            status=502,
                        )

                return _json_response({"detail": "not found"}, status=404)
            except Exception as exc:
                return _json_response(
                    {
                        "ok": False,
                        "stage": "fetch",
                        "error": type(exc).__name__,
                        "detail": str(exc),
                    },
                    status=500,
                )
