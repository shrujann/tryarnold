"""Telegram transport using raw Bot API calls over httpx."""
from __future__ import annotations

import io

import httpx

from app.channels.base import InboundMessage, InboundPhoto, MessagingChannel
from app.config import settings
from app.logging_config import get_logger
from app.text_style import strip_emoji

log = get_logger(__name__)


class TelegramHttpxChannel(MessagingChannel):
    name = "telegram"

    def __init__(self, token: str | None = None) -> None:
        self._token = token or settings.telegram_bot_token
        self._http: httpx.AsyncClient | None = None

    @property
    def enabled(self) -> bool:
        return bool(self._token)

    @property
    def _base_url(self) -> str:
        if not self._token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        return f"https://api.telegram.org/bot{self._token}"

    @property
    def _file_url(self) -> str:
        if not self._token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        return f"https://api.telegram.org/file/bot{self._token}"

    async def initialize(self) -> None:
        if self.enabled and self._http is None:
            self._http = httpx.AsyncClient(timeout=30.0)

    async def shutdown(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    async def _ensure_ready(self) -> httpx.AsyncClient:
        await self.initialize()
        if self._http is None:
            raise RuntimeError("Telegram HTTP client unavailable")
        return self._http

    async def _call(
        self,
        method: str,
        *,
        data: dict | None = None,
        files: dict | None = None,
    ) -> dict:
        http = await self._ensure_ready()
        resp = await http.post(f"{self._base_url}/{method}", data=data, files=files)
        resp.raise_for_status()
        payload = resp.json()
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description", f"Telegram {method} failed"))
        return payload["result"]

    async def send_text(self, chat_id: int, text: str) -> None:
        text = strip_emoji(text)
        for chunk in _chunk(text, 4096):
            await self._call(
                "sendMessage",
                data={"chat_id": str(chat_id), "text": chunk},
            )

    async def send_text_with_keyboard(
        self, chat_id: int, text: str, buttons: list[list[tuple[str, str]]]
    ) -> None:
        import json

        reply_markup = {
            "inline_keyboard": [
                [{"text": label, "callback_data": data} for label, data in row]
                for row in buttons
            ]
        }
        await self._call(
            "sendMessage",
            data={
                "chat_id": str(chat_id),
                "text": strip_emoji(text),
                "reply_markup": json.dumps(reply_markup),
            },
        )

    async def answer_callback(self, callback_query_id: str) -> None:
        try:
            await self._call(
                "answerCallbackQuery", data={"callback_query_id": callback_query_id}
            )
        except Exception:
            log.debug("answerCallbackQuery failed", exc_info=True)

    async def send_photo(self, chat_id: int, file_id_or_bytes, caption: str | None = None) -> None:
        caption = strip_emoji(caption) if caption else caption
        if isinstance(file_id_or_bytes, (bytes, bytearray)):
            files = {"photo": ("photo.jpg", bytes(file_id_or_bytes), "image/jpeg")}
            data = {"chat_id": str(chat_id)}
            if caption:
                data["caption"] = caption
            await self._call("sendPhoto", data=data, files=files)
            return
        data = {"chat_id": str(chat_id), "photo": str(file_id_or_bytes)}
        if caption:
            data["caption"] = caption
        await self._call("sendPhoto", data=data)

    async def send_document(
        self, chat_id: int, data: bytes, filename: str, caption: str | None = None
    ) -> None:
        payload = {"chat_id": str(chat_id)}
        if caption:
            payload["caption"] = strip_emoji(caption)
        files = {"document": (filename, io.BytesIO(data), "application/octet-stream")}
        await self._call("sendDocument", data=payload, files=files)

    async def download_photo(self, file_id: str) -> bytes:
        result = await self._call("getFile", data={"file_id": file_id})
        path = result.get("file_path")
        if not path:
            raise RuntimeError("Telegram file_path missing")
        http = await self._ensure_ready()
        resp = await http.get(f"{self._file_url}/{path}")
        resp.raise_for_status()
        return resp.content

    async def set_webhook(self) -> bool:
        await self._call(
            "setWebhook",
            data={
                "url": settings.webhook_url,
                "secret_token": settings.telegram_webhook_secret,
                "allowed_updates": '["message","callback_query"]',
                "drop_pending_updates": "true",
            },
        )
        return True

    async def delete_webhook(self) -> bool:
        await self._call(
            "deleteWebhook",
            data={"drop_pending_updates": "false"},
        )
        return True

    def parse_update(self, update: dict) -> InboundMessage | None:
        callback = update.get("callback_query")
        if isinstance(callback, dict):
            from_user = callback.get("from") or {}
            message = callback.get("message") or {}
            chat = message.get("chat") or {}
            return InboundMessage(
                channel=self.name,
                external_user_id=int(from_user.get("id")),
                chat_id=int(chat.get("id", from_user.get("id"))),
                text=callback.get("data"),
                callback_data=callback.get("data"),
                callback_query_id=callback.get("id"),
                username=from_user.get("username"),
                first_name=from_user.get("first_name"),
                raw=update,
            )

        message = update.get("message") or update.get("edited_message")
        if not isinstance(message, dict):
            return None
        from_user = message.get("from") or {}
        if "id" not in from_user:
            return None

        photo = None
        photos = message.get("photo") or []
        if photos:
            largest = photos[-1]
            photo = InboundPhoto(
                file_id=largest["file_id"],
                file_unique_id=largest["file_unique_id"],
                width=largest.get("width"),
                height=largest.get("height"),
            )

        chat = message.get("chat") or {}
        return InboundMessage(
            channel=self.name,
            external_user_id=int(from_user["id"]),
            chat_id=int(chat.get("id", from_user["id"])),
            text=message.get("text"),
            photo=photo,
            caption=message.get("caption"),
            username=from_user.get("username"),
            first_name=from_user.get("first_name"),
            raw=update,
        )


def _chunk(text: str, size: int):
    if not text:
        yield ""
        return
    for i in range(0, len(text), size):
        yield text[i : i + size]
