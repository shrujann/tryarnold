"""Deterministic message-style enforcement (the tone "contract").

This module makes the tone rules enforceable rather than merely requested:
- ``strip_emoji`` removes emoji/pictographic characters while preserving all
  other Unicode (names, accents, non-English text, units, punctuation).
- ``style_chat_reply`` applies emoji stripping plus a *safe* length guard for
  LLM-driven chat replies. It never cuts mid-sentence: it trims at a sentence
  boundary and only when the text is well over budget.

Static command/report copy is written to spec directly; these helpers are the
last line of defense for anything dynamic (LLM output, captions).
"""
from __future__ import annotations

import re

# Emoji / pictographic ranges. Deliberately scoped to emoji blocks so we do NOT
# strip general non-ASCII text (accented names, non-Latin scripts, etc.).
_EMOJI_PATTERN = re.compile(
    "["
    "\U0001f300-\U0001faff"  # symbols, pictographs, emoticons, supplemental
    "\U00002600-\U000027bf"  # misc symbols + dingbats
    "\U0001f1e6-\U0001f1ff"  # regional indicators (flags)
    "\U00002190-\U000021ff"  # arrows (often used decoratively)
    "\U00002b00-\U00002bff"  # misc symbols and arrows (stars, etc.)
    "\U0000fe00-\U0000fe0f"  # variation selectors
    "\U0000200d"             # zero-width joiner (emoji sequences)
    "\U000020e3"             # combining enclosing keycap
    "]+",
    flags=re.UNICODE,
)

# Default soft budget for LLM chat replies. Command/help/report copy is exempt.
DEFAULT_MAX_CHARS = 280
# Only enforce a cut well beyond the budget, so normal replies are untouched.
_HARD_GUARD_CHARS = 600

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def strip_emoji(text: str | None) -> str:
    """Remove emoji/pictographs; collapse whitespace they leave behind."""
    if not text:
        return text or ""
    cleaned = _EMOJI_PATTERN.sub("", text)
    # Tidy up spaces/newlines left dangling by removed glyphs.
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    lines = [line.rstrip() for line in cleaned.split("\n")]
    return "\n".join(lines).strip()


def _safe_length_guard(text: str, max_chars: int) -> str:
    """Trim only extreme outputs, and only at a sentence boundary.

    We never blindly cut mid-sentence (which could drop consent wording, a macro
    total, or a clarifying question). If we cannot find a clean boundary under
    the hard guard, we leave the text as-is rather than mangle it.
    """
    if len(text) <= _HARD_GUARD_CHARS:
        return text

    sentences = _SENTENCE_END.split(text)
    kept: list[str] = []
    total = 0
    for sentence in sentences:
        if kept and total + len(sentence) > max_chars:
            break
        kept.append(sentence)
        total += len(sentence) + 1

    candidate = " ".join(s.strip() for s in kept).strip()
    # Only use the trimmed version if it preserved something meaningful.
    if candidate and len(candidate) >= 40:
        return candidate
    return text


def style_chat_reply(text: str | None, max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Full styling pass for dynamic chat replies: strip emoji + safe length."""
    cleaned = strip_emoji(text)
    if not cleaned:
        return cleaned
    return _safe_length_guard(cleaned, max_chars)
