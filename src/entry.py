from __future__ import annotations

import json
import os
import time
from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint

from app.runtime import bind_worker_env

DEBUG_LOG_PATH = "/Users/shrujan/Documents/GitHub/tryarnold/.cursor/debug-c72a96.log"
DEBUG_SESSION_ID = "c72a96"


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
    return Response(json.dumps(data), status=status, headers={"content-type": "application/json"})


# region agent log
def _debug_log(hypothesis_id: str, location: str, message: str, data: dict | None = None) -> None:
    payload = {
        "sessionId": DEBUG_SESSION_ID,
        "runId": "pre-fix",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000),
    }
    line = json.dumps(payload, separators=(",", ":"))
    try:
        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass
    try:
        print(line)
    except Exception:
        pass
# endregion


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        started_at = time.time()
        _bootstrap_env(self.env)
        with bind_worker_env(self.env):
            _debug_log("H3", "src/entry.py:58", "fetch_enter", {"url": str(request.url), "method": str(request.method)})
            try:
                from app.config import settings
                from app.worker_app import delete_webhook, health_payload, process_update, set_webhook, sync_settings

                _debug_log("H1", "src/entry.py:63", "imports_loaded", {"elapsed_ms": int((time.time() - started_at) * 1000)})
                sync_settings()
                url = urlparse(str(request.url))
                path = url.path
                method = str(request.method).upper()
                _debug_log("H1", "src/entry.py:68", "post_sync_settings", {"path": path, "method": method, "elapsed_ms": int((time.time() - started_at) * 1000)})

                if path == "/favicon.ico":
                    return Response("", status=204)

                if method == "GET" and path == "/healthz":
                    _debug_log("H2", "src/entry.py:74", "health_route_before_payload", {"elapsed_ms": int((time.time() - started_at) * 1000)})
                    return _json_response(health_payload())

                if method == "POST" and path == settings.webhook_path:
                    secret = request.headers.get("x-telegram-bot-api-secret-token")
                    if secret != settings.telegram_webhook_secret:
                        return _json_response({"detail": "invalid secret token"}, status=403)
                    update = await request.json()
                    try:
                        await process_update(update)
                    except Exception as exc:
                        return _json_response({"ok": False, "error": str(exc)}, status=500)
                    return _json_response({"ok": True})

                if method == "POST" and path == "/admin/set-webhook":
                    try:
                        return _json_response(await set_webhook())
                    except Exception as exc:
                        return _json_response({"detail": str(exc)}, status=502)

                if method == "POST" and path == "/admin/delete-webhook":
                    try:
                        return _json_response(await delete_webhook())
                    except Exception as exc:
                        return _json_response({"detail": str(exc)}, status=502)

                return _json_response({"detail": "not found"}, status=404)
            except Exception as exc:
                _debug_log("H1", "src/entry.py:99", "fetch_exception", {"type": type(exc).__name__, "detail": str(exc), "elapsed_ms": int((time.time() - started_at) * 1000)})
                raise
