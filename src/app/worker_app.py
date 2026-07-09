"""Cloudflare Workers business logic backed by D1 + OpenAI."""
from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from workers import fetch

from app.channels.base import InboundMessage
from app.channels.telegram_httpx import TelegramHttpxChannel
from app.config import get_settings, settings
from app.logging_config import get_logger
from app.runtime import current_worker_env
from app.schemas.nutrition import MacroEstimate
from app.services.pending_meal import action_factors, normalize_action
from app.text_style import strip_emoji, style_chat_reply

log = get_logger(__name__)

HELP = (
    "how this works:\n"
    "- text me what you ate or send a food photo\n"
    "- /progress - today's summary\n"
    "- /last-analysis - last logged meal\n"
    "- /help - this message\n\n"
    "note: proactive check-ins, pdf reports, and fatsecret are not on this worker."
)
WELCOME = (
    "hey, i'm your fitness coach. text meals or send food pics and i'll track "
    "them.\n\nwhat's the main goal right now?"
)

_channel: TelegramHttpxChannel | None = None


def sync_settings() -> None:
    get_settings.cache_clear()
    get_settings()


def get_channel() -> TelegramHttpxChannel:
    global _channel
    if _channel is None:
        _channel = TelegramHttpxChannel()
    return _channel


def health_payload() -> dict:
    channel = get_channel()
    payload = {
        "status": "ok",
        "app": settings.app_name,
        "ai_enabled": settings.ai_enabled,
        "fatsecret_enabled": False,
        "memory_backend": "d1-context",
        "telegram_enabled": channel.enabled,
        "runtime": "worker",
    }
    return payload


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db():
    env = current_worker_env()
    if env is None or getattr(env, "DB", None) is None:
        raise RuntimeError("D1 binding DB is unavailable")
    return env.DB


async def _all(sql: str, *binds: Any) -> list[dict]:
    stmt = _db().prepare(sql)
    if binds:
        stmt = stmt.bind(*binds)
    result = await stmt.all()
    return list(result.results or [])


async def _first(sql: str, *binds: Any) -> dict | None:
    rows = await _all(sql, *binds)
    return rows[0] if rows else None


async def _run(sql: str, *binds: Any) -> None:
    stmt = _db().prepare(sql)
    if binds:
        stmt = stmt.bind(*binds)
    await stmt.run()


async def get_or_create_user(msg: InboundMessage) -> dict:
    row = await _first("SELECT * FROM users WHERE telegram_id = ?", msg.external_user_id)
    if row:
        if msg.username and row.get("username") != msg.username:
            await _run(
                "UPDATE users SET username = ?, first_name = COALESCE(?, first_name) WHERE id = ?",
                msg.username,
                msg.first_name,
                row["id"],
            )
        return row

    await _run(
        "INSERT INTO users (telegram_id, username, first_name, timezone, nudges_enabled, consent_health_data, phone_verified, onboarded, portion_multiplier, created_at) VALUES (?, ?, ?, 'UTC', 1, 0, 0, 0, 1.0, ?)",
        msg.external_user_id,
        msg.username,
        msg.first_name,
        _utcnow(),
    )
    created = await _first("SELECT * FROM users WHERE telegram_id = ?", msg.external_user_id)
    if created is None:
        raise RuntimeError("failed to create user")
    return created


async def log_message(
    user_id: int, direction: str, content: str | None, kind: str = "text"
) -> None:
    await _run(
        "INSERT INTO messages (user_id, ts, direction, channel, content, kind) VALUES (?, ?, ?, 'telegram', ?, ?)",
        user_id,
        _utcnow(),
        direction,
        content,
        kind,
    )


async def daily_totals(user: dict) -> dict:
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    row = await _first(
        "SELECT COALESCE(SUM(calories),0) AS calories, COALESCE(SUM(protein_g),0) AS protein_g, COALESCE(SUM(carbs_g),0) AS carbs_g, COALESCE(SUM(fat_g),0) AS fat_g, COUNT(*) AS meals FROM meals WHERE user_id = ? AND ts >= ?",
        user["id"],
        start.isoformat(),
    )
    return row or {
        "calories": 0,
        "protein_g": 0,
        "carbs_g": 0,
        "fat_g": 0,
        "meals": 0,
    }


async def recent_context(user: dict) -> str:
    totals = await daily_totals(user)
    meals = await _all(
        "SELECT description, calories, ts FROM meals WHERE user_id = ? ORDER BY ts DESC LIMIT 5",
        user["id"],
    )
    messages = await _all(
        "SELECT direction, content FROM messages WHERE user_id = ? ORDER BY ts DESC LIMIT 8",
        user["id"],
    )
    lines = [
        f"user_id={user['id']} timezone={user.get('timezone') or 'UTC'}",
        f"goal={user.get('goal_summary') or 'not set'}",
        (
            f"today={round(float(totals['calories']))} kcal "
            f"P{round(float(totals['protein_g']))} "
            f"C{round(float(totals['carbs_g']))} "
            f"F{round(float(totals['fat_g']))} "
            f"meals={int(totals['meals'])}"
        ),
    ]
    if meals:
        lines.append("recent meals:")
        for meal in meals:
            lines.append(
                f"- {meal.get('description') or 'meal'}: "
                f"{round(float(meal['calories']))} kcal"
            )
    if messages:
        lines.append("recent chat (newest first):")
        for message in messages:
            content = (message.get("content") or "")[:180]
            lines.append(f"- {message.get('direction')}: {content}")
    return "\n".join(lines)


async def openai_chat(messages: list[dict], *, vision: bool = False) -> str | None:
    if not settings.openai_api_key:
        return None
    model = settings.openai_vision_model if vision else settings.openai_model
    resp = await fetch(
        "https://api.openai.com/v1/chat/completions",
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.openai_api_key}",
            "Content-Type": "application/json",
        },
        body=json.dumps({"model": model, "temperature": 0.4, "messages": messages}),
    )
    data = await resp.json()
    if not isinstance(data, dict):
        return None
    if data.get("error"):
        raise RuntimeError(str(data["error"]))
    return (data.get("choices") or [{}])[0].get("message", {}).get("content")


async def estimate_from_image(image_bytes: bytes, caption: str | None) -> MacroEstimate:
    if not settings.ai_enabled:
        return MacroEstimate(
            description=caption or "food photo",
            confidence=0.0,
            assumptions=["AI vision disabled"],
        )
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    prompt = (
        "Identify this meal. Return ONLY compact JSON with keys: description, "
        "calories, protein_g, carbs_g, fat_g, food_confidence, portion_confidence, "
        "assumptions (array of strings), items (array of {name, quantity, "
        "plate_share, calories, protein_g, carbs_g, fat_g}). Max 3 items. "
        "quantity descriptive only (no grams unless user stated). plate_share 0-1."
    )
    if caption:
        prompt += f" User note: {caption}"
    content = await openai_chat(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    },
                ],
            }
        ],
        vision=True,
    )
    if not content:
        return MacroEstimate(description=caption or "food photo", confidence=0.0)
    try:
        start = content.find("{")
        end = content.rfind("}")
        payload = json.loads(content[start : end + 1])
        estimate = MacroEstimate.from_dict(payload)
        if estimate.food_confidence or estimate.portion_confidence:
            estimate.confidence = min(
                estimate.food_confidence or 1.0,
                estimate.portion_confidence or 1.0,
            )
        return estimate
    except Exception:
        log.exception("Failed to parse vision JSON")
        return MacroEstimate(
            description=caption or "food photo",
            confidence=0.2,
            assumptions=["vision JSON parse failed"],
        )


async def _send(
    channel: TelegramHttpxChannel, chat_id: int, user_id: int, text: str
) -> None:
    text = strip_emoji(text)
    await channel.send_text(chat_id, text)
    await log_message(user_id, "out", text)


async def _handle_command(
    channel: TelegramHttpxChannel, chat_id: int, user: dict, text: str
) -> bool:
    cmd = text.split()[0].lower().lstrip("/").split("@")[0]
    user_id = int(user["id"])
    if cmd in {"start", "help"}:
        await _send(channel, chat_id, user_id, HELP if cmd == "help" else WELCOME)
        return True
    if cmd == "progress":
        totals = await daily_totals(user)
        await _send(
            channel,
            chat_id,
            user_id,
            f"today: {round(float(totals['calories']))} kcal, "
            f"P{round(float(totals['protein_g']))}g "
            f"C{round(float(totals['carbs_g']))}g "
            f"F{round(float(totals['fat_g']))}g, "
            f"{int(totals['meals'])} meal(s)",
        )
        return True
    if cmd in {"report", "week", "pause", "resume", "nudge-test", "test-nudge"}:
        await _send(
            channel,
            chat_id,
            user_id,
            "that feature isn't on this cloudflare worker yet",
        )
        return True
    if cmd == "last-analysis":
        meal = await _first(
            "SELECT * FROM meals WHERE user_id = ? ORDER BY ts DESC LIMIT 1",
            user_id,
        )
        if meal is None:
            await _send(channel, chat_id, user_id, "no meals logged yet")
            return True
        await _send(
            channel,
            chat_id,
            user_id,
            f"last meal: {meal.get('description') or 'meal'}\n"
            f"totals: {round(float(meal['calories']))} kcal, "
            f"P{round(float(meal['protein_g']))}g "
            f"C{round(float(meal['carbs_g']))}g "
            f"F{round(float(meal['fat_g']))}g",
        )
        return True
    return False


async def _handle_photo(
    channel: TelegramHttpxChannel, msg: InboundMessage, user: dict
) -> None:
    user_id = int(user["id"])
    chat_id = msg.chat_id
    if not settings.ai_enabled:
        await _send(
            channel,
            chat_id,
            user_id,
            "can't read photos right now. set OPENAI_API_KEY and try again.",
        )
        return
    try:
        image_bytes = await channel.download_photo(msg.photo.file_id)
        estimate = await estimate_from_image(image_bytes, msg.caption)
    except Exception:
        log.exception("Photo processing failed")
        await _send(
            channel,
            chat_id,
            user_id,
            "couldn't read that photo. tell me roughly what it was.",
        )
        return

    multiplier = float(user.get("portion_multiplier") or 1.0)
    if multiplier != 1.0:
        estimate = estimate.apply_multiplier(multiplier)
    if estimate.calories > settings.meal_confirm_max_calories:
        estimate.portion_confidence = min(estimate.portion_confidence or 0.5, 0.3)

    await _run("DELETE FROM pending_meals WHERE user_id = ?", user_id)
    await _run(
        "INSERT INTO pending_meals (user_id, estimate_json, base_multiplier, tg_file_id, tg_file_unique_id, photo_caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        user_id,
        json.dumps(estimate.to_dict()),
        multiplier,
        msg.photo.file_id,
        msg.photo.file_unique_id,
        msg.caption,
        _utcnow(),
    )

    names = [item.name for item in (estimate.items or [])[:3]]
    summary = " + ".join(names) if names else (estimate.description or "meal")
    macros = (
        f"P{round(estimate.protein_g)} C{round(estimate.carbs_g)} "
        f"F{round(estimate.fat_g)}"
    )
    if estimate.needs_portion_confirm(settings.portion_confidence_threshold):
        prompt = (
            f"{summary} - around {round(estimate.calories)} kcal ({macros}), "
            "but portion's unclear. how big was it?"
        )
        buttons = [
            [("Small", "meal:size_s"), ("Medium", "meal:size_m"), ("Large", "meal:size_l")],
            [("Skip", "meal:skip")],
        ]
    else:
        prompt = (
            f"{summary} - ~{round(estimate.calories)} kcal ({macros}). "
            "tap to log or adjust."
        )
        buttons = [
            [("Log", "meal:log"), ("Smaller", "meal:smaller"), ("Bigger", "meal:bigger")],
            [("Skip", "meal:skip")],
        ]
    await channel.send_text_with_keyboard(chat_id, strip_emoji(prompt), buttons)
    await log_message(user_id, "out", strip_emoji(prompt))


async def _handle_confirmation(
    channel: TelegramHttpxChannel,
    msg: InboundMessage,
    user: dict,
    action: str,
) -> None:
    if msg.callback_query_id:
        await channel.answer_callback(msg.callback_query_id)

    user_id = int(user["id"])
    chat_id = msg.chat_id
    pending = await _first("SELECT * FROM pending_meals WHERE user_id = ?", user_id)
    if pending is None:
        await _send(channel, chat_id, user_id, "nothing pending to confirm")
        return

    factor = action_factors().get(action)
    if factor is None:
        await _run("DELETE FROM pending_meals WHERE user_id = ?", user_id)
        await _send(channel, chat_id, user_id, "got it, skipped that one")
        return

    raw = pending["estimate_json"]
    payload = json.loads(raw) if isinstance(raw, str) else raw
    estimate = MacroEstimate.from_dict(payload)
    if factor != 1.0:
        estimate = estimate.apply_multiplier(factor)

    await _run(
        "INSERT INTO meals (user_id, ts, source, description, calories, protein_g, carbs_g, fat_g, confidence, items_json, tg_file_id, tg_file_unique_id, photo_caption) VALUES (?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        user_id,
        _utcnow(),
        estimate.description,
        estimate.calories,
        estimate.protein_g,
        estimate.carbs_g,
        estimate.fat_g,
        estimate.confidence,
        json.dumps([item.__dict__ for item in estimate.items]),
        pending.get("tg_file_id"),
        pending.get("tg_file_unique_id"),
        pending.get("photo_caption"),
    )
    if factor != 1.0:
        alpha = 0.5
        updated = max(
            0.6,
            min(
                1.4,
                (float(user.get("portion_multiplier") or 1.0)) * (factor**alpha),
            ),
        )
        await _run(
            "UPDATE users SET portion_multiplier = ? WHERE id = ?",
            round(updated, 3),
            user_id,
        )
    await _run("DELETE FROM pending_meals WHERE user_id = ?", user_id)
    await _send(
        channel,
        chat_id,
        user_id,
        f"logged {estimate.description or 'meal'} - {round(estimate.calories)} kcal, "
        f"P{round(estimate.protein_g)}g C{round(estimate.carbs_g)}g "
        f"F{round(estimate.fat_g)}g",
    )


async def process_update(update: dict) -> None:
    channel = get_channel()
    msg = channel.parse_update(update)
    if msg is None:
        return

    user = await get_or_create_user(msg)
    user_id = int(user["id"])
    chat_id = msg.chat_id
    kind = "photo" if msg.has_photo else ("system" if msg.is_callback else "text")
    await log_message(user_id, "in", msg.display_text, kind=kind)

    text = (msg.text or "").strip()
    if not msg.is_callback and text.startswith("/"):
        if await _handle_command(channel, chat_id, user, text):
            return

    action = normalize_action(msg.callback_data or text)
    if action is not None:
        pending = await _first("SELECT * FROM pending_meals WHERE user_id = ?", user_id)
        if msg.is_callback or pending:
            await _handle_confirmation(channel, msg, user, action)
            return

    if msg.is_callback:
        if msg.callback_query_id:
            await channel.answer_callback(msg.callback_query_id)
        return

    if msg.has_photo:
        await _handle_photo(channel, msg, user)
        return

    context = await recent_context(user)
    reply = await openai_chat(
        [
            {
                "role": "system",
                "content": (
                    "You are a concise fitness coach on Telegram. No emojis. "
                    "Keep replies short. Use the durable user context below. "
                    "Ask clarifying questions when needed.\n\n"
                    f"CONTEXT:\n{context}"
                ),
            },
            {"role": "user", "content": text or "(empty message)"},
        ]
    )
    if not reply:
        reply = (
            "no ai key set right now so i can't chat fully yet. try /help."
            if not settings.ai_enabled
            else "couldn't generate a reply right now"
        )
    else:
        reply = style_chat_reply(reply)
    await _send(channel, chat_id, user_id, reply)


async def set_webhook() -> dict:
    channel = get_channel()
    if not channel.enabled:
        raise RuntimeError("Telegram not configured")
    ok = await channel.set_webhook()
    return {"ok": ok, "url": settings.webhook_url}


async def delete_webhook() -> dict:
    channel = get_channel()
    if not channel.enabled:
        raise RuntimeError("Telegram not configured")
    ok = await channel.delete_webhook()
    return {"ok": ok}
