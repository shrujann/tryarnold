"""Pydantic models for nutrition analysis / vision JSON."""
from __future__ import annotations

from pydantic import BaseModel, Field


class FoodItem(BaseModel):
    name: str
    quantity: str | None = Field(default=None)
    plate_share: float | None = Field(default=None, ge=0.0, le=1.0)
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0


class MacroEstimate(BaseModel):
    items: list[FoodItem] = Field(default_factory=list)
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    food_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    portion_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    assumptions: list[str] = Field(default_factory=list)
    description: str = ""

    def needs_portion_confirm(self, threshold: float = 0.6) -> bool:
        return self.portion_confidence < threshold

    def apply_multiplier(self, factor: float) -> "MacroEstimate":
        scaled_items = [
            item.model_copy(
                update={
                    "calories": round(item.calories * factor, 1),
                    "protein_g": round(item.protein_g * factor, 1),
                    "carbs_g": round(item.carbs_g * factor, 1),
                    "fat_g": round(item.fat_g * factor, 1),
                }
            )
            for item in self.items
        ]
        return self.model_copy(
            update={
                "items": scaled_items,
                "calories": round(self.calories * factor, 1),
                "protein_g": round(self.protein_g * factor, 1),
                "carbs_g": round(self.carbs_g * factor, 1),
                "fat_g": round(self.fat_g * factor, 1),
            }
        )
