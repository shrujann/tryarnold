"""FatSecret Platform API client (Basic / OAuth 2.0).

GPT-4o identifies foods; this module looks them up in FatSecret's verified
database and applies sensible default portions when weight is unknown.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from functools import lru_cache

import httpx

from app.config import settings
from app.logging_config import get_logger
from app.schemas.nutrition import FoodItem, MacroEstimate

log = get_logger(__name__)

_TOKEN_URL = "https://oauth.fatsecret.com/connect/token"
_API_URL = "https://platform.fatsecret.com/rest/server.api"

_DESC_RE = re.compile(
    r"Per (.+?) - Calories:\s*([\d.]+)\s*kcal \| Fat:\s*([\d.]+)\s*g \| "
    r"Carbs:\s*([\d.]+)\s*g \| Protein:\s*([\d.]+)\s*g",
    re.IGNORECASE,
)
_GRAMS_RE = re.compile(r"([\d.]+)\s*g\b", re.IGNORECASE)

# GPT vision often invents huge gram weights; only scale when user states grams in text.
_MIN_SCALE_GRAMS = 20.0
_MAX_SCALE_GRAMS = 600.0
_MAX_ITEM_CALORIES = 900.0
_MAX_SERVING_GRAMS = 500.0

# When portion weight is unknown, estimate it from how full the vessel is:
#   item_grams = plate_share * reference_full_vessel_grams
_FULL_PLATE_GRAMS = 400.0
_FULL_BOWL_GRAMS = 400.0
# Conservative bias when the model gives no plate_share (grilled: bias low).
_DEFAULT_PLATE_SHARE = 0.5

_SEARCH_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "likely",
        "mixed",
        "some",
        "the",
        "with",
    }
)


@dataclass
class FatSecretFood:
    food_id: str
    food_name: str
    food_description: str
    brand_name: str | None = None


@dataclass
class ParsedServing:
    serving_label: str
    calories: float
    protein_g: float
    carbs_g: float
    fat_g: float
    serving_grams: float | None = None


class FatSecretClient:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._http = httpx.AsyncClient(timeout=20.0)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _get_token(self) -> str:
        now = time.time()
        if self._token and now < self._token_expires_at - 60:
            return self._token

        resp = await self._http.post(
            _TOKEN_URL,
            data={"grant_type": "client_credentials", "scope": "basic"},
            auth=(self._client_id, self._client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expires_at = now + int(data.get("expires_in", 86400))
        return self._token

    async def _call(self, method: str, **params: str | int) -> dict:
        token = await self._get_token()
        payload = {"method": method, "format": "json", **params}
        resp = await self._http.post(
            _API_URL,
            data=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        data = resp.json()
        if "error" in data:
            code = data["error"].get("code")
            message = data["error"].get("message", "unknown error")
            raise RuntimeError(f"FatSecret API error {code}: {message}")
        return data

    async def search_food(self, expression: str, *, max_results: int = 3) -> FatSecretFood | None:
        expression = expression.strip()
        if not expression:
            return None
        try:
            data = await self._call(
                "foods.search",
                search_expression=expression,
                max_results=max_results,
                page_number=0,
            )
        except Exception:
            log.exception("FatSecret search failed for %r", expression)
            return None

        foods = data.get("foods") or {}
        raw = foods.get("food")
        if not raw:
            return None
        candidates = raw if isinstance(raw, list) else [raw]
        for candidate in candidates:
            food = FatSecretFood(
                food_id=str(candidate.get("food_id", "")),
                food_name=str(candidate.get("food_name", expression)),
                food_description=str(candidate.get("food_description", "")),
                brand_name=candidate.get("brand_name"),
            )
            serving = parse_food_description(food.food_description)
            if serving and _serving_is_reasonable(serving):
                return food
        first = candidates[0]
        return FatSecretFood(
            food_id=str(first.get("food_id", "")),
            food_name=str(first.get("food_name", expression)),
            food_description=str(first.get("food_description", "")),
            brand_name=first.get("brand_name"),
        )

    async def get_food_servings(self, food_id: str) -> list[ParsedServing]:
        try:
            data = await self._call("food.get.v2", food_id=food_id)
        except Exception:
            log.exception("FatSecret food.get failed for %s", food_id)
            return []

        food = data.get("food") or {}
        servings_raw = (food.get("servings") or {}).get("serving")
        if not servings_raw:
            return []
        if not isinstance(servings_raw, list):
            servings_raw = [servings_raw]

        parsed: list[ParsedServing] = []
        for row in servings_raw:
            serving = _serving_from_get(row)
            if serving is not None:
                parsed.append(serving)
        return parsed


def _serving_is_reasonable(serving: ParsedServing) -> bool:
    if serving.calories > _MAX_ITEM_CALORIES:
        return False
    if serving.serving_grams is not None and serving.serving_grams > _MAX_SERVING_GRAMS:
        return False
    return True


def _serving_from_get(row: dict) -> ParsedServing | None:
    try:
        calories = float(row.get("calories", 0))
        protein_g = float(row.get("protein", 0))
        carbs_g = float(row.get("carbohydrate", 0))
        fat_g = float(row.get("fat", 0))
    except (TypeError, ValueError):
        return None
    label = str(row.get("serving_description") or "serving")
    grams = None
    metric = row.get("metric_serving_amount")
    unit = str(row.get("metric_serving_unit") or "").lower()
    if metric is not None and unit == "g":
        try:
            grams = float(metric)
        except (TypeError, ValueError):
            grams = None
    if grams is None:
        grams_match = _GRAMS_RE.search(label)
        if grams_match:
            grams = float(grams_match.group(1))
    return ParsedServing(
        serving_label=label,
        calories=calories,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
        serving_grams=grams,
    )


def parse_food_description(description: str) -> ParsedServing | None:
    match = _DESC_RE.search(description)
    if not match:
        return None
    serving_label = match.group(1).strip()
    serving_grams = None
    grams_match = _GRAMS_RE.search(serving_label)
    if grams_match:
        serving_grams = float(grams_match.group(1))
    return ParsedServing(
        serving_label=serving_label,
        calories=float(match.group(2)),
        protein_g=float(match.group(5)),
        carbs_g=float(match.group(4)),
        fat_g=float(match.group(3)),
        serving_grams=serving_grams,
    )


def _simplify_search_query(name: str) -> str:
    cleaned = re.sub(r"\([^)]*\)", "", name)
    words = re.findall(r"[a-zA-Z]+", cleaned.lower())
    kept = [w for w in words if w not in _SEARCH_STOPWORDS]
    if not kept:
        return name.strip()
    return " ".join(kept[:4])


def _is_soup_like(name: str) -> bool:
    lowered = name.lower()
    return any(token in lowered for token in ("soup", "broth", "stew", "pho", "ramen"))


def _quantity_grams(quantity: str | None) -> float | None:
    if not quantity:
        return None
    match = _GRAMS_RE.search(quantity)
    return float(match.group(1)) if match else None


def _should_scale_quantity(quantity: str | None, *, enabled: bool) -> bool:
    if not enabled or not quantity:
        return False
    qty_g = _quantity_grams(quantity)
    if qty_g is None:
        return False
    return _MIN_SCALE_GRAMS <= qty_g <= _MAX_SCALE_GRAMS


def _scale_serving(serving: ParsedServing, target_grams: float, label: str) -> ParsedServing:
    if serving.serving_grams is None or serving.serving_grams <= 0:
        return serving
    factor = target_grams / serving.serving_grams
    return ParsedServing(
        serving_label=label,
        calories=round(serving.calories * factor, 1),
        protein_g=round(serving.protein_g * factor, 1),
        carbs_g=round(serving.carbs_g * factor, 1),
        fat_g=round(serving.fat_g * factor, 1),
        serving_grams=target_grams,
    )


def _pick_best_serving(servings: list[ParsedServing]) -> ParsedServing | None:
    reasonable = [s for s in servings if _serving_is_reasonable(s)]
    if not reasonable:
        return None

    def score(serving: ParsedServing) -> tuple[int, float]:
        label = serving.serving_label.lower()
        points = 0
        if "100 g" in label or label == "100g" or label.startswith("100 g"):
            points += 50
        if "1 cup" in label:
            points += 45
        if "1 bowl" in label:
            points += 44
        if "1 serving" in label or label == "serving":
            points += 40
        if "1 plate" in label:
            points += 38
        if serving.serving_grams is not None:
            # Prefer human-scale portions over tiny samples.
            if 80 <= serving.serving_grams <= 400:
                points += 20
            elif serving.serving_grams > _MAX_SERVING_GRAMS:
                points -= 30
        if serving.calories > _MAX_ITEM_CALORIES:
            points -= 40
        return (points, -abs((serving.serving_grams or 200) - 200))

    return max(reasonable, key=score)


async def _resolve_serving(
    client: FatSecretClient,
    match: FatSecretFood,
    *,
    item_name: str,
    quantity: str | None,
    plate_share: float | None,
    scale_quantity: bool,
) -> tuple[ParsedServing, str]:
    """Pick a sensible serving when exact weight is unknown.

    Photo portions are estimated from how full the vessel is (``plate_share``)
    rather than the raw FatSecret serving, which may be a tiny sample or an
    absurd bulk entry.
    """
    servings = await client.get_food_servings(match.food_id)
    serving = _pick_best_serving(servings)
    if serving is None:
        serving = parse_food_description(match.food_description)
    if serving is None:
        raise ValueError("no parseable serving")

    # Text meals where the user stated grams explicitly.
    if _should_scale_quantity(quantity, enabled=scale_quantity):
        qty_g = _quantity_grams(quantity)
        assert qty_g is not None
        scaled = _scale_serving(serving, qty_g, f"{quantity}")
        return scaled, f"used user-stated portion ({quantity})"

    # Weight unknown: derive grams from vessel fill fraction.
    is_soup = _is_soup_like(item_name)
    full_vessel = _FULL_BOWL_GRAMS if is_soup else _FULL_PLATE_GRAMS
    share = plate_share if plate_share is not None else _DEFAULT_PLATE_SHARE
    share = min(max(share, 0.1), 1.0)
    target_grams = round(full_vessel * share)
    vessel = "bowl" if is_soup else "plate"

    if serving.serving_grams is None or serving.serving_grams <= 0:
        # No gram basis to scale from; keep the raw serving.
        return serving, (
            f"portion weight unknown; used FatSecret serving "
            f"'{serving.serving_label}' ({int(share * 100)}% {vessel} fill assumed)"
        )

    label = f"~{target_grams}g ({int(share * 100)}% {vessel})"
    scaled = _scale_serving(serving, target_grams, label)
    note = (
        f"portion weight unknown; estimated {target_grams}g "
        f"({int(share * 100)}% {vessel} fill) from '{serving.serving_label}'"
    )
    return scaled, note


def _food_from_serving(
    match: FatSecretFood,
    serving: ParsedServing,
    *,
    quantity_label: str,
) -> FoodItem:
    label = match.food_name
    if match.brand_name:
        label = f"{match.brand_name} {label}"
    return FoodItem(
        name=label,
        quantity=quantity_label,
        calories=serving.calories,
        protein_g=serving.protein_g,
        carbs_g=serving.carbs_g,
        fat_g=serving.fat_g,
        fatsecret_food_id=match.food_id,
        fatsecret_match=f"Per {serving.serving_label} - Calories: {round(serving.calories)}kcal",
    )


async def enrich_estimate(
    estimate: MacroEstimate, *, scale_quantities: bool = False
) -> MacroEstimate:
    """Replace GPT macro guesses with FatSecret lookups where possible."""
    client = get_fatsecret_client()
    if client is None:
        return estimate

    assumptions = list(estimate.assumptions)
    enriched_items: list[FoodItem] = []
    matched = 0

    if estimate.items:
        for item in estimate.items:
            query = _simplify_search_query(item.name)
            match = await client.search_food(query)
            if match is None:
                enriched_items.append(item)
                assumptions.append(f"{item.name}: no FatSecret match, kept vision estimate")
                continue
            try:
                serving, portion_note = await _resolve_serving(
                    client,
                    match,
                    item_name=item.name,
                    quantity=item.quantity,
                    plate_share=item.plate_share,
                    scale_quantity=scale_quantities,
                )
            except ValueError:
                enriched_items.append(item)
                assumptions.append(f"{item.name}: FatSecret serving unreadable")
                continue

            enriched_items.append(
                _food_from_serving(
                    match,
                    serving,
                    quantity_label=serving.serving_label,
                )
            )
            assumptions.append(
                f"{item.name}: FatSecret #{match.food_id} ({match.food_description})"
            )
            assumptions.append(portion_note)
            matched += 1
    elif estimate.description.strip():
        query = _simplify_search_query(estimate.description)
        match = await client.search_food(query)
        if match is not None:
            try:
                serving, portion_note = await _resolve_serving(
                    client,
                    match,
                    item_name=estimate.description,
                    quantity=None,
                    plate_share=None,
                    scale_quantity=False,
                )
                enriched_items.append(
                    _food_from_serving(
                        match, serving, quantity_label=serving.serving_label
                    )
                )
                assumptions.append(
                    f"FatSecret #{match.food_id} ({match.food_description})"
                )
                assumptions.append(portion_note)
                matched += 1
            except ValueError:
                pass

    if matched == 0:
        return estimate

    calories = sum(i.calories for i in enriched_items)
    protein_g = sum(i.protein_g for i in enriched_items)
    carbs_g = sum(i.carbs_g for i in enriched_items)
    fat_g = sum(i.fat_g for i in enriched_items)
    # Matching a verified food raises our certainty of WHAT it is, but the
    # portion is still a guess — leave portion_confidence untouched so the
    # confirmation gate still fires.
    food_confidence = min(0.9, max(estimate.food_confidence, 0.7))
    portion_confidence = estimate.portion_confidence

    return MacroEstimate(
        items=enriched_items,
        calories=calories,
        protein_g=protein_g,
        carbs_g=carbs_g,
        fat_g=fat_g,
        confidence=min(food_confidence, portion_confidence),
        food_confidence=food_confidence,
        portion_confidence=portion_confidence,
        assumptions=assumptions,
        description=estimate.description,
    )


@lru_cache
def get_fatsecret_client() -> FatSecretClient | None:
    if not settings.fatsecret_enabled:
        return None
    return FatSecretClient(
        settings.fatsecret_client_id or "",
        settings.fatsecret_client_secret or "",
    )
