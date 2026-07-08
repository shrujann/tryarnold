"""Telegram implementation of :class:`MessagingChannel`.

Uses ``python-telegram-bot`` in webhook mode. Inbound updates arrive at the
FastAPI webhook; we verify the secret-token header there, then hand the raw
payload to :meth:`parse_update`.
"""
from __future__ import annotations

import io

from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.error import TimedOut
from telegram.request import HTTPXRequest

from app.channels.base import InboundMessage, InboundPhoto, MessagingChannel
from app.config import settings
from app.logging_config import get_logger
from app.text_style import strip_emoji

log = get_logger(__name__)


class TelegramChannel(MessagingChannel):
    name = "telegram"

    def __init__(self, token: str | None = None) -> None:
        self._token = token or settings.telegram_bot_token
        self._bot: Bot | None = None
        self._initialized = False

    @property
    def enabled(self) -> bool:
        return bool(self._token)

    @property
    def bot(self) -> Bot:
        if not self._token:
            raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
        if self._bot is None:
            # Generous pool for concurrent sends. Telegram media fetches can be
            # noticeably slower than text requests, so use roomier timeouts.
            request = HTTPXRequest(
                connection_pool_size=8,
                connect_timeout=10.0,
                read_timeout=30.0,
                write_timeout=30.0,
                pool_timeout=10.0,
            )
            self._bot = Bot(token=self._token, request=request)
        return self._bot

    async def initialize(self) -> None:
        if self.enabled and not self._initialized:
            await self.bot.initialize()
            self._initialized = True

    async def _ensure_ready(self) -> None:
        """Lazily initialize on first use so a startup-time connectivity blip
        doesn't permanently disable the transport."""
        if not self._initialized:
            await self.initialize()

    async def shutdown(self) -> None:
        if self._bot is not None:
            await self._bot.shutdown()
            self._initialized = False

    # ----- outbound -----
    # Emoji is stripped here as the final transport-level guard, so no outbound
    # text or caption can carry emoji regardless of its source (LLM, canned,
    # captions passed by callers).
    async def send_text(self, chat_id: int, text: str) -> None:
        await self._ensure_ready()
        text = strip_emoji(text)
        # Telegram hard-limits messages to 4096 chars; chunk long replies.
        for chunk in _chunk(text, 4096):
            await self.bot.send_message(chat_id=chat_id, text=chunk)

    async def send_text_with_keyboard(
        self, chat_id: int, text: str, buttons: list[list[tuple[str, str]]]
    ) -> None:
        await self._ensure_ready()
        text = strip_emoji(text)
        markup = InlineKeyboardMarkup(
            [
                [InlineKeyboardButton(label, callback_data=data) for label, data in row]
                for row in buttons
            ]
        )
        await self.bot.send_message(chat_id=chat_id, text=text, reply_markup=markup)

    async def answer_callback(self, callback_query_id: str) -> None:
        await self._ensure_ready()
        try:
            await self.bot.answer_callback_query(callback_query_id)
        except Exception:  # pragma: no cover - non-fatal spinner cleanup
            log.debug("answer_callback_query failed", exc_info=True)

    async def send_photo(
        self, chat_id: int, file_id_or_bytes, caption: str | None = None
    ) -> None:
        await self._ensure_ready()
        await self.bot.send_photo(
            chat_id=chat_id,
            photo=file_id_or_bytes,
            caption=strip_emoji(caption) if caption else caption,
        )

    async def send_document(
        self, chat_id: int, data: bytes, filename: str, caption: str | None = None
    ) -> None:
        await self._ensure_ready()
        bio = io.BytesIO(data)
        bio.name = filename
        await self.bot.send_document(
            chat_id=chat_id,
            document=bio,
            filename=filename,
            caption=strip_emoji(caption) if caption else caption,
        )

    async def download_photo(self, file_id: str) -> bytes:
        await self._ensure_ready()
        for attempt in range(2):
            try:
                tg_file = await self.bot.get_file(file_id)
                buf = bytearray()
                await tg_file.download_as_bytearray(buf)
                return bytes(buf)
            except TimedOut:
                if attempt == 1:
                    raise
                log.warning("Telegram photo download timed out; retrying once")
        raise RuntimeError("unreachable")

    async def set_webhook(self) -> bool:
        await self._ensure_ready()
        return await self.bot.set_webhook(
            url=settings.webhook_url,
            secret_token=settings.telegram_webhook_secret,
            allowed_updates=["message", "callback_query"],
            drop_pending_updates=True,
        )

    async def delete_webhook(self) -> bool:
        await self._ensure_ready()
        return await self.bot.delete_webhook(drop_pending_updates=False)

    # ----- inbound -----
    def parse_update(self, update: dict) -> InboundMessage | None:
        try:
            upd = Update.de_json(update, self.bot if self._token else None)
        except Exception:  # pragma: no cover - defensive
            log.exception("Failed to parse Telegram update")
            return None

        # Inline-button tap (portion confirmation).
        if upd.callback_query is not None and upd.callback_query.from_user is not None:
            cq = upd.callback_query
            chat_id = cq.message.chat_id if cq.message is not None else cq.from_user.id
            return InboundMessage(
                channel=self.name,
                external_user_id=cq.from_user.id,
                chat_id=chat_id,
                text=cq.data,
                callback_data=cq.data,
                callback_query_id=cq.id,
                username=cq.from_user.username,
                first_name=cq.from_user.first_name,
                raw=update,
            )

        msg = upd.message or upd.edited_message
        if msg is None or msg.from_user is None:
            return None

        photo: InboundPhoto | None = None
        if msg.photo:
            # Telegram sends multiple sizes; the last is the largest.
            largest = msg.photo[-1]
            photo = InboundPhoto(
                file_id=largest.file_id,
                file_unique_id=largest.file_unique_id,
                width=largest.width,
                height=largest.height,
            )

        return InboundMessage(
            channel=self.name,
            external_user_id=msg.from_user.id,
            chat_id=msg.chat_id,
            text=msg.text,
            photo=photo,
            caption=msg.caption,
            username=msg.from_user.username,
            first_name=msg.from_user.first_name,
            raw=update,
        )


def _chunk(text: str, size: int):
    if not text:
        yield ""
        return
    for i in range(0, len(text), size):
        yield text[i : i + size]
