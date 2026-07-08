"""Channel-agnostic messaging interface.

The agent, tools, scheduler and reports depend ONLY on this interface, never
on Telegram directly. Adding iMessage (via a relay) or WhatsApp later means
implementing a new ``MessagingChannel`` — nothing else changes.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class InboundPhoto:
    file_id: str
    file_unique_id: str
    width: int | None = None
    height: int | None = None


@dataclass
class InboundMessage:
    """Normalized inbound message, independent of the source channel."""

    channel: str
    external_user_id: int  # e.g. Telegram user id
    chat_id: int
    text: str | None = None
    photo: InboundPhoto | None = None
    caption: str | None = None
    username: str | None = None
    first_name: str | None = None
    # Set when the message is an inline-button tap (e.g. "meal:log"). The id is
    # needed to acknowledge the callback and stop Telegram's loading spinner.
    callback_data: str | None = None
    callback_query_id: str | None = None
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    raw: dict | None = None

    @property
    def has_photo(self) -> bool:
        return self.photo is not None

    @property
    def is_callback(self) -> bool:
        return self.callback_data is not None

    @property
    def display_text(self) -> str:
        return self.text or self.caption or ""


class MessagingChannel(abc.ABC):
    """Abstract transport for a conversational channel."""

    name: str = "base"

    @abc.abstractmethod
    async def send_text(self, chat_id: int, text: str) -> None: ...

    @abc.abstractmethod
    async def send_text_with_keyboard(
        self, chat_id: int, text: str, buttons: list[list[tuple[str, str]]]
    ) -> None:
        """Send text with inline buttons. ``buttons`` is rows of (label, data)."""

    @abc.abstractmethod
    async def answer_callback(self, callback_query_id: str) -> None:
        """Acknowledge an inline-button tap (clears the client loading state)."""

    @abc.abstractmethod
    async def send_photo(
        self, chat_id: int, file_id_or_bytes, caption: str | None = None
    ) -> None: ...

    @abc.abstractmethod
    async def send_document(
        self, chat_id: int, data: bytes, filename: str, caption: str | None = None
    ) -> None: ...

    @abc.abstractmethod
    async def download_photo(self, file_id: str) -> bytes: ...

    @abc.abstractmethod
    def parse_update(self, update: dict) -> InboundMessage | None:
        """Convert a raw provider payload into an ``InboundMessage``."""
