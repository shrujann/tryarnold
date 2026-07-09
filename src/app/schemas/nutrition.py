"""Plain dataclasses for nutrition analysis (no pydantic)."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class FoodItem:
    name: str
    quantity: str | None = None
    plate_share: float | None = None
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


@dataclass
class MacroEstimate:
    items: list[FoodItem] = field(default_factory=list)
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    confidence: float = 0.0
    food_confidence: float = 0.0
    portion_confidence: float = 0.0
    assumptions: list[str] = field(default_factory=list)
    description: str = ""

    def needs_portion_confirm(self, threshold: float = 0.6) -> bool:
        return self.portion_confidence < threshold

    def apply_multiplier(self, factor: float) -> "MacroEstimate":
        scaled_items = [
            FoodItem(
                name=item.name,
                quantity=item.quantity,
                plate_share=item.plate_share,
                calories=round(item.calories * factor, 1),
                protein_g=round(item.protein_g * factor, 1),
                carbs_g=round(item.carbs_g * factor, 1),
                fat_g=round(item.fat_g * factor, 1),
            )
            for item in self.items
        ]
        return MacroEstimate(
            items=scaled_items,
            calories=round(self.calories * factor, 1),
            protein_g=round(self.protein_g * factor, 1),
            carbs_g=round(self.carbs_g * factor, 1),
            fat_g=round(self.fat_g * factor, 1),
            confidence=self.confidence,
            food_confidence=self.food_confidence,
            portion_confidence=self.portion_confidence,
            assumptions=list(self.assumptions),
            description=self.description,
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> "MacroEstimate":
        items_raw = payload.get("items") or []
        items = [
            FoodItem(
                name=str(item.get("name") or "item"),
                quantity=item.get("quantity"),
                plate_share=item.get("plate_share"),
                calories=float(item.get("calories") or 0),
                protein_g=float(item.get("protein_g") or 0),
                carbs_g=float(item.get("carbs_g") or 0),
                fat_g=float(item.get("fat_g") or 0),
            )
            for item in items_raw
            if isinstance(item, dict)
        ]
        estimate = cls(
            items=items,
            calories=float(payload.get("calories") or 0),
            protein_g=float(payload.get("protein_g") or 0),
            carbs_g=float(payload.get("carbs_g") or 0),
            fat_g=float(payload.get("fat_g") or 0),
            confidence=float(payload.get("confidence") or 0),
            food_confidence=float(payload.get("food_confidence") or 0),
            portion_confidence=float(payload.get("portion_confidence") or 0),
            assumptions=list(payload.get("assumptions") or []),
            description=str(payload.get("description") or ""),
        )
        if estimate.food_confidence or estimate.portion_confidence:
            estimate.confidence = min(
                estimate.food_confidence or 1.0,
                estimate.portion_confidence or 1.0,
            )
        return estimate
