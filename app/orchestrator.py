"""Inbound message orchestration (channel-agnostic).

Flow: normalize -> identify user -> handle slash-commands deterministically ->
(photo) run vision -> run agent -> send reply. Works with or without AI keys.
"""
from __future__ import annotations

from app.agent.context import build_user_context
from app.agent.graph import run_agent
from app.channels.base import InboundMessage, MessagingChannel
from app.config import settings
from app.db.base import session_scope
from app.logging_config import get_logger
from app.reports.generator import build_daily_report_pdf, build_weekly_report_pdf
from app.schemas.nutrition import MacroEstimate
from app.services import logging_service, pending_meal, progress, users
from app.scheduler.proactive import NUDGE_REASONS, send_test_nudge
from app.text_style import strip_emoji, style_chat_reply
from app.vision import food

log = get_logger(__name__)

WELCOME = (
    "hey, i'm your fitness coach. just text me what you eat, send food pics, and "
    "tell me about workouts. i'll track it and check in.\n\n"
    "what's the main goal right now?"
)

HELP = (
    "how this works:\n"
    "- text me what you ate or send a food photo\n"
    "- tell me about workouts and i'll log them\n"
    "- /progress - today's summary\n"
    "- /report - daily report\n"
    "- /week - weekly report\n"
    "- /pause and /resume - control check-ins\n"
    "- /nudge-test [breakfast|lunch|dinner|gym|reengage] - preview a check-in\n"
    "- /last-analysis - breakdown of your last logged meal (debug)\n"
    "- /help - this message"
)


async def handle_inbound(channel: MessagingChannel, msg: InboundMessage) -> None:
    async with session_scope() as session:
        user, created = await users.get_or_create_from_inbound(session, msg)
        user_id = user.id
        chat_id = msg.chat_id
        kind = "photo" if msg.has_photo else ("system" if msg.is_callback else "text")
        await logging_service.log_message(
            session, user_id, "in", msg.display_text, kind=kind
        )

    text = (msg.text or "").strip()

    # 1) Deterministic slash-commands (work regardless of AI availability).
    if not msg.is_callback and text.startswith("/"):
        handled = await _handle_command(channel, chat_id, user_id, text)
        if handled:
            return

    # 2) Portion confirmation for a pending photo meal (inline tap or text reply).
    action = pending_meal.normalize_action(msg.callback_data or text)
    if action is not None:
        async with session_scope() as session:
            pending = await pending_meal.has_pending(session, user_id)
        if msg.is_callback or pending:
            await _handle_confirmation(channel, msg, user_id, chat_id, action)
            return

    if msg.is_callback:
        # A tap with no matching pending meal (expired / already handled).
        if msg.callback_query_id:
            await channel.answer_callback(msg.callback_query_id)
        return

    if created:
        await _send(channel, chat_id, user_id, WELCOME)
        if not settings.ai_enabled:
            return  # without AI we can only greet + accept commands

    # 3) Food photo -> analyze -> confirm before logging (does NOT hit the agent).
    if msg.has_photo:
        await _handle_photo(channel, msg, user_id, chat_id, text)
        return

    agent_input = text or "(the user sent an empty message)"

    # 4) Run the agent (falls back to a canned reply if AI is off).
    async with session_scope() as session:
        user = await users.get_by_id(session, user_id)
        context = await build_user_context(session, user)

    reply = await run_agent(user_id, context, agent_input)
    if reply is None:
        reply = _fallback_reply(msg)
    else:
        # Style guard for dynamic LLM output: strip emoji + safe length.
        reply = style_chat_reply(reply)

    await _send(channel, chat_id, user_id, reply)


async def _handle_photo(
    channel: MessagingChannel,
    msg: InboundMessage,
    user_id: int,
    chat_id: int,
    text: str,
) -> None:
    """Analyze a food photo and ask the user to confirm the portion before
    logging. The image bytes are discarded after analysis."""
    if not settings.ai_enabled:
        await _send(channel, chat_id, user_id, _fallback_reply(msg))
        return

    try:
        image_bytes = await channel.download_photo(msg.photo.file_id)
        estimate = await food.estimate_from_image(image_bytes, caption=msg.caption)
    except Exception:
        log.exception("Photo processing failed")
        await _send(
            channel,
            chat_id,
            user_id,
            "couldn't read that photo. tell me roughly what it was and i'll log it.",
        )
        return

    if estimate.calories <= 0 and not estimate.items:
        await _send(
            channel,
            chat_id,
            user_id,
            "couldn't make out the food. what was it? i'll log it from your description.",
        )
        return

    # Apply the user's learned portion bias, then run a sanity cap.
    async with session_scope() as session:
        user = await users.get_by_id(session, user_id)
        multiplier = (user.portion_multiplier if user else 1.0) or 1.0

    if multiplier != 1.0:
        estimate = estimate.apply_multiplier(multiplier)

    if estimate.calories > settings.meal_confirm_max_calories:
        estimate.portion_confidence = min(estimate.portion_confidence, 0.3)
        estimate.assumptions.append(
            "total looks high for one meal; double-check the portion"
        )

    log.info(
        "Photo analysis: %s | portion_conf=%.2f | assumptions: %s",
        estimate.totals_line(),
        estimate.portion_confidence,
        "; ".join(estimate.assumptions) or "none",
    )

    async with session_scope() as session:
        await pending_meal.save_pending(
            session,
            user_id,
            estimate=estimate,
            base_multiplier=multiplier,
            tg_file_id=msg.photo.file_id,
            tg_file_unique_id=msg.photo.file_unique_id,
            photo_caption=msg.caption,
        )

    summary = _meal_summary(estimate)
    macros = (
        f"P{round(estimate.protein_g)} C{round(estimate.carbs_g)} "
        f"F{round(estimate.fat_g)}"
    )

    if estimate.needs_portion_confirm(settings.portion_confidence_threshold):
        prompt = (
            f"{summary} — around {round(estimate.calories)} kcal ({macros}), "
            "but portion's unclear. how big was it?"
        )
        buttons = [
            [("Small", "meal:size_s"), ("Medium", "meal:size_m"), ("Large", "meal:size_l")],
            [("Skip", "meal:skip")],
        ]
    else:
        prompt = (
            f"{summary} — ~{round(estimate.calories)} kcal ({macros}). "
            "portion's a rough guess. tap to log or adjust."
        )
        buttons = [
            [("Log", "meal:log"), ("Smaller", "meal:smaller"), ("Bigger", "meal:bigger")],
            [("Skip", "meal:skip")],
        ]

    await channel.send_text_with_keyboard(chat_id, strip_emoji(prompt), buttons)
    async with session_scope() as session:
        await logging_service.log_message(session, user_id, "out", strip_emoji(prompt))


async def _handle_confirmation(
    channel: MessagingChannel,
    msg: InboundMessage,
    user_id: int,
    chat_id: int,
    action: str,
) -> None:
    if msg.callback_query_id:
        await channel.answer_callback(msg.callback_query_id)

    async with session_scope() as session:
        result = await pending_meal.confirm(session, user_id, action)

    if result.status == "logged" and result.estimate is not None:
        est = result.estimate
        reply = (
            f"logged {_meal_summary(est)} — {round(est.calories)} kcal, "
            f"P{round(est.protein_g)}g C{round(est.carbs_g)}g F{round(est.fat_g)}g"
        )
    elif result.status == "skipped":
        reply = "got it, skipped that one"
    elif result.status == "expired":
        reply = "that photo timed out. send it again and i'll re-check the portion"
    else:  # unknown / nothing pending
        reply = "nothing pending to confirm. send a food pic and i'll estimate it"

    await _send(channel, chat_id, user_id, reply)


def _meal_summary(estimate: MacroEstimate) -> str:
    if estimate.items:
        names = [i.name for i in estimate.items[:3]]
        return " + ".join(names)
    return estimate.description or "meal"


async def _handle_command(
    channel: MessagingChannel, chat_id: int, user_id: int, text: str
) -> bool:
    cmd = text.split()[0].lower().lstrip("/").split("@")[0]

    if cmd in {"start", "help"}:
        await _send(channel, chat_id, user_id, HELP if cmd == "help" else WELCOME)
        return True

    if cmd == "progress":
        async with session_scope() as session:
            user = await users.get_by_id(session, user_id)
            totals = await progress.daily_totals(session, user)
        target = f" / {totals.target_calories}" if totals.target_calories else ""
        await _send(
            channel,
            chat_id,
            user_id,
            f"today: {round(totals.calories)} kcal{target}, "
            f"P{round(totals.protein_g)}g C{round(totals.carbs_g)}g "
            f"F{round(totals.fat_g)}g, {totals.meals} meal(s), "
            f"{totals.workouts} workout(s)",
        )
        return True

    if cmd in {"report", "week"}:
        await _send(channel, chat_id, user_id, "one sec, pulling your report")
        async with session_scope() as session:
            user = await users.get_by_id(session, user_id)
            if cmd == "report":
                pdf, fname = await build_daily_report_pdf(session, user)
            else:
                pdf, fname = await build_weekly_report_pdf(session, user)
        await channel.send_document(chat_id, pdf, fname, caption="here's your report")
        return True

    if cmd in {"pause", "resume"}:
        enabled = cmd == "resume"
        async with session_scope() as session:
            await users.update_profile(session, user_id, nudges_enabled=enabled)
        await _send(
            channel,
            chat_id,
            user_id,
            "check-ins back on" if enabled else "check-ins paused. text /resume anytime",
        )
        return True

    if cmd in {"nudge-test", "test-nudge"}:
        parts = text.split()
        reason = parts[1].lower() if len(parts) > 1 else "breakfast"
        if reason not in NUDGE_REASONS:
            opts = ", ".join(sorted(NUDGE_REASONS))
            await _send(
                channel,
                chat_id,
                user_id,
                f"unknown nudge type. try: /nudge-test ({opts})",
            )
            return True
        try:
            await send_test_nudge(channel, user_id, reason)
        except Exception:
            log.exception("Test nudge failed")
            await _send(channel, chat_id, user_id, "couldn't send test nudge, check app logs")
        return True

    if cmd == "last-analysis":
        async with session_scope() as session:
            meal = await logging_service.get_last_meal(session, user_id)
        if meal is None:
            await _send(channel, chat_id, user_id, "no meals logged yet")
            return True
        lines = [
            f"last meal: {meal.description or 'meal'}",
            f"totals: {round(meal.calories)} kcal, P{round(meal.protein_g)}g "
            f"C{round(meal.carbs_g)}g F{round(meal.fat_g)}g",
            f"confidence: {meal.confidence:.2f}" if meal.confidence is not None else "",
        ]
        for row in meal.items_json or []:
            name = row.get("name", "?")
            qty = row.get("quantity") or "?"
            fs_id = row.get("fatsecret_food_id")
            fs_match = row.get("fatsecret_match")
            item_line = (
                f"- {name} ({qty}): {round(row.get('calories', 0))} kcal, "
                f"P{round(row.get('protein_g', 0))}g"
            )
            if fs_id:
                item_line += f" | FatSecret #{fs_id}"
            lines.append(item_line)
            if fs_match:
                lines.append(f"  {fs_match}")
        await _send(channel, chat_id, user_id, "\n".join(line for line in lines if line))
        return True

    return False


def _fallback_reply(msg: InboundMessage) -> str:
    if msg.has_photo:
        return (
            "can't read photos right now. tell me roughly what it was and i'll "
            "log it. (set OPENAI_API_KEY to turn on photo macros)"
        )
    return (
        "no ai key set right now so i can't chat fully yet. try /help to see "
        "what still works."
    )


async def _send(
    channel: MessagingChannel, chat_id: int, user_id: int, text: str
) -> None:
    # Clean here too so the logged copy matches exactly what the channel sends.
    text = strip_emoji(text)
    await channel.send_text(chat_id, text)
    async with session_scope() as session:
        await logging_service.log_message(session, user_id, "out", text)
