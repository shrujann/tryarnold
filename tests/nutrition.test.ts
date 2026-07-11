import { describe, expect, it } from "vitest";
import {
  applyMultiplier,
  macroEstimateFromDict,
  macroEstimateSchema,
  needsPortionConfirm,
  normalizeMacroEstimate,
  normalizePortionEstimate,
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

  it("parses portion and weight fields", () => {
    const raw = {
      description: "iced latte",
      calories: 165,
      protein_g: 8,
      carbs_g: 12,
      fat_g: 6,
      food_confidence: 0.85,
      portion_confidence: 0.7,
      assumptions: [],
      portion: {
        container_type: "cup",
        container_volume_ml: 400,
        fill_fraction: 0.75,
        notes: "medium cup with ice",
      },
      items: [
        {
          name: "whole milk",
          weight_g: 255,
          volume_ml: 255,
          volume_fraction: 0.65,
          calories: 160,
          protein_g: 8,
          carbs_g: 12,
          fat_g: 6,
        },
      ],
    };
    const parsed = macroEstimateSchema.parse(raw);
    expect(parsed.portion?.container_volume_ml).toBe(400);
    expect(parsed.items[0]!.weight_g).toBe(255);
    expect(parsed.items[0]!.volume_ml).toBe(255);
  });

  it("caps overfilled cup liquid volumes and rescales macros", () => {
    const estimate = normalizePortionEstimate({
      description: "iced latte",
      calories: 400,
      protein_g: 15,
      carbs_g: 30,
      fat_g: 10,
      confidence: 0.8,
      food_confidence: 0.8,
      portion_confidence: 0.8,
      assumptions: [],
      portion: {
        container_type: "cup",
        container_volume_ml: 300,
        fill_fraction: 0.75,
        notes: null,
      },
      items: [
        {
          name: "whole milk",
          weight_g: 300,
          volume_ml: 300,
          volume_fraction: 0.8,
          calories: 200,
          protein_g: 10,
          carbs_g: 15,
          fat_g: 8,
        },
        {
          name: "coffee",
          weight_g: 100,
          volume_ml: 100,
          volume_fraction: 0.3,
          calories: 200,
          protein_g: 5,
          carbs_g: 15,
          fat_g: 2,
        },
      ],
    });

    const maxMl = 300 * 0.75;
    const totalMl =
      (estimate.items[0]!.volume_ml ?? 0) + (estimate.items[1]!.volume_ml ?? 0);
    expect(totalMl).toBeCloseTo(maxMl, 0);
    expect(estimate.calories).toBeLessThan(400);
    expect(estimate.assumptions.some((a) => a.startsWith("portion:"))).toBe(true);
    expect(estimate.portion_confidence).toBeLessThanOrEqual(0.5);
  });

  it("keeps vision cup item weights without hardcoded rebalance", () => {
    const estimate = normalizePortionEstimate({
      description: "iced coffee with milk",
      calories: 250,
      protein_g: 8,
      carbs_g: 20,
      fat_g: 10,
      confidence: 0.8,
      food_confidence: 0.8,
      portion_confidence: 0.7,
      assumptions: [],
      portion: {
        container_type: "cup",
        container_volume_ml: 400,
        fill_fraction: 0.7,
        notes: "medium plastic cup",
      },
      items: [
        {
          name: "whole milk",
          weight_g: 100,
          calories: 100,
          protein_g: 5,
          carbs_g: 8,
          fat_g: 5,
        },
        {
          name: "brewed coffee",
          weight_g: 150,
          calories: 150,
          protein_g: 3,
          carbs_g: 12,
          fat_g: 5,
        },
      ],
    });

    expect(estimate.items[0]!.weight_g).toBe(100);
    expect(estimate.items[1]!.weight_g).toBe(150);
    expect(estimate.assumptions.some((a) => a.includes("65/35"))).toBe(false);
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
