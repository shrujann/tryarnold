"""Food photo / description -> structured macro estimate.

Uses GPT-4o vision/text for food identification, then optionally enriches
macros via FatSecret search when credentials are configured.
"""
from __future__ import annotations

import base64

from app.config import settings
from app.logging_config import get_logger
from app.schemas.nutrition import MacroEstimate
from app.services.fatsecret import enrich_estimate

log = get_logger(__name__)

_SYSTEM = (
    "You identify foods and portions from photos or text. Rules:\n"
    "- Break the meal into AT MOST 3 items (main + side + drink). Never list "
    "every ingredient; group them (e.g. 'stir-fried noodles with veg').\n"
    "- quantity: descriptive serving only ('1 bowl', '1 plate', '1 cup', "
    "'1 piece'). Do NOT put gram weights unless the user explicitly stated them.\n"
    "- plate_share: for each item, the fraction (0-1) of its own vessel it "
    "fills. Items sharing one plate should sum to ~1.0; a soup in its own bowl "
    "is 1.0.\n"
    "- Estimate total calories and macros as a rough fallback.\n"
    "- food_confidence (0-1): how sure you are of WHAT the foods are.\n"
    "- portion_confidence (0-1): how sure you are of HOW MUCH there is. Lower "
    "it for mixed/composite dishes, missing size reference (no fork/plate edge), "
    "restaurant-sized or ambiguous portions, or more than 3 visual components.\n"
    "- List key assumptions."
)


def _get_structured_model():
    """Return a structured-output LLM, or None if AI is disabled."""
    if not settings.ai_enabled:
        return None
    try:
        from langchain_openai import ChatOpenAI

        model = ChatOpenAI(
            model=settings.openai_vision_model,
            api_key=settings.openai_api_key,
            temperature=0,
        )
        return model.with_structured_output(MacroEstimate)
    except Exception:  # pragma: no cover - defensive
        log.exception("Could not initialize vision model")
        return None


async def estimate_from_image(
    image_bytes: bytes, caption: str | None = None, mime: str = "image/jpeg"
) -> MacroEstimate:
    structured = _get_structured_model()
    if structured is None:
        return MacroEstimate(
            description=caption or "food photo",
            confidence=0.0,
            assumptions=["AI vision disabled; no macro estimate available"],
        )

    from langchain_core.messages import HumanMessage, SystemMessage

    b64 = base64.b64encode(image_bytes).decode("utf-8")
    text = "Estimate the nutrition for this meal."
    if caption:
        text += f" User note: {caption}"

    human = HumanMessage(
        content=[
            {"type": "text", "text": text},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            },
        ]
    )
    try:
        result: MacroEstimate = await structured.ainvoke(
            [SystemMessage(content=_SYSTEM), human]
        )
        if not result.description:
            result.description = caption or "meal from photo"
        _combine_confidence(result)
        return await enrich_estimate(result, scale_quantities=False)
    except Exception:
        log.exception("Vision estimate failed")
        return MacroEstimate(
            description=caption or "food photo",
            confidence=0.0,
            assumptions=["vision request failed"],
        )


async def estimate_from_text(description: str) -> MacroEstimate:
    structured = _get_structured_model()
    if structured is None:
        return MacroEstimate(description=description, confidence=0.0)

    from langchain_core.messages import HumanMessage, SystemMessage

    try:
        result: MacroEstimate = await structured.ainvoke(
            [
                SystemMessage(content=_SYSTEM),
                HumanMessage(
                    content=f"Estimate the nutrition for this meal: {description}"
                ),
            ]
        )
        if not result.description:
            result.description = description
        _combine_confidence(result)
        return await enrich_estimate(result, scale_quantities=True)
    except Exception:
        log.exception("Text macro estimate failed")
        return MacroEstimate(description=description, confidence=0.0)


def _combine_confidence(estimate: MacroEstimate) -> None:
    """Set the combined ``confidence`` from the split scores.

    Older prompts only populated ``confidence``; if the split scores are absent
    (0.0) fall back to the combined value so nothing regresses.
    """
    if estimate.food_confidence == 0.0 and estimate.portion_confidence == 0.0:
        estimate.food_confidence = estimate.confidence
        estimate.portion_confidence = estimate.confidence
        return
    estimate.confidence = min(estimate.food_confidence, estimate.portion_confidence)
