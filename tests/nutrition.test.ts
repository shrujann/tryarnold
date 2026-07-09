import { describe, expect, it } from "vitest";
import {
  applyMultiplier,
  macroEstimateFromDict,
  macroEstimateSchema,
  needsPortionConfirm,
  normalizeMacroEstimate,
} from "../src/schemas/nutrition";

describe("MacroEstimateSchema", () => {
  it("parses a valid estimate", () => {
    const raw = {
      description: "chicken rice",
      calories: 600,
      protein_g: 30,
      carbs_g: 70,
      fat_g: 15,
      food_confidence: 0.9,
      portion_confidence: 0.5,
      assumptions: ["estimated portion"],
      items: [{ name: "chicken", calories: 300, protein_g: 25, carbs_g: 0, fat_g: 10 }],
    };
    const parsed = macroEstimateSchema.parse(raw);
    expect(parsed.description).toBe("chicken rice");
    expect(parsed.items).toHaveLength(1);
  });

  it("normalizes confidence from food and portion", () => {
    const estimate = normalizeMacroEstimate({
      description: "salad",
      calories: 200,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
      confidence: 0,
      food_confidence: 0.8,
      portion_confidence: 0.6,
      assumptions: [],
      items: [],
    });
    expect(estimate.confidence).toBe(0.6);
  });

  it("applies multiplier to macros", () => {
    const base = macroEstimateFromDict({
      description: "pasta",
      calories: 100,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
      items: [{ name: "pasta", calories: 100, protein_g: 10, carbs_g: 20, fat_g: 5 }],
    });
    const scaled = applyMultiplier(base, 0.7);
    expect(scaled.calories).toBe(70);
    expect(scaled.protein_g).toBe(7);
  });

  it("detects portion confirmation need", () => {
    const estimate = macroEstimateFromDict({
      description: "burger",
      calories: 500,
      protein_g: 25,
      carbs_g: 40,
      fat_g: 25,
      portion_confidence: 0.4,
    });
    expect(needsPortionConfirm(estimate, 0.6)).toBe(true);
  });
});
