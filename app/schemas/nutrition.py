"""Pydantic models for nutrition analysis.

These are the validation / LLM-I/O layer. ``MacroEstimate`` is the strict
structured-output schema the vision model must return.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class FoodItem(BaseModel):
    name: str
    quantity: str | None = Field(
        default=None, description="e.g. '1 cup', 'approx 150g'"
    )
    plate_share: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Fraction of the food's own vessel this item fills (0-1). Items "
            "sharing one plate should sum to ~1.0; a soup in its own bowl is 1.0."
        ),
    )
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    fatsecret_food_id: str | None = None
    fatsecret_match: str | None = Field(
        default=None, description="FatSecret food_description for this match"
    )


class MacroEstimate(BaseModel):
    """Structured result of a food photo / description analysis."""

    items: list[FoodItem] = Field(default_factory=list)
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    food_confidence: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Certainty about WHAT the food is"
    )
    portion_confidence: float = Field(
        default=0.0, ge=0.0, le=1.0, description="Certainty about HOW MUCH there is"
    )
    assumptions: list[str] = Field(default_factory=list)
    description: str = ""

    def is_low_confidence(self, threshold: float = 0.5) -> bool:
        return self.confidence < threshold

    def needs_portion_confirm(self, threshold: float = 0.6) -> bool:
        return self.portion_confidence < threshold

    def apply_multiplier(self, factor: float) -> "MacroEstimate":
        """Return a copy with all macros (and per-item macros) scaled."""
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

    def totals_line(self) -> str:
        return (
            f"{round(self.calories)} kcal · "
            f"P {round(self.protein_g)}g · "
            f"C {round(self.carbs_g)}g · "
            f"F {round(self.fat_g)}g"
        )


class ImageRef(BaseModel):
    """Lightweight, persisted reference to an image kept on Telegram."""

    file_id: str
    file_unique_id: str
    width: int | None = None
    height: int | None = None
    taken_at: datetime
    caption: str | None = None


class DailyTotals(BaseModel):
    date: str
    calories: float = 0
    protein_g: float = 0
    carbs_g: float = 0
    fat_g: float = 0
    meals: int = 0
    workouts: int = 0
    workout_minutes: int = 0

    target_calories: int | None = None
    target_protein_g: int | None = None
    target_carbs_g: int | None = None
    target_fat_g: int | None = None
