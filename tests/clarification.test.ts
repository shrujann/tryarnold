import { describe, expect, it } from "vitest";
import type { MacroEstimate } from "../src/schemas/nutrition";
import {
  buildClarifyPlan,
  buildClarifyPrefetchCandidates,
  buildExclusiveKeyboard,
  buildToggleKeyboard,
  clearToggles,
  mergeClarifyIntoDraft,
  toggleSelection,
} from "../src/services/clarification";

const drinkEstimate: MacroEstimate = {
  description: "iced latte",
  confidence: 0.8,
  food_confidence: 0.8,
  portion_confidence: 0.7,
  assumptions: [],
  calories: 120,
  protein_g: 6,
  carbs_g: 10,
  fat_g: 5,
  portion: {
    container_type: "cup",
    container_volume_ml: 400,
    fill_fraction: 0.75,
    notes: null,
  },
  items: [
    {
      name: "whole milk",
      weight_g: 195,
      volume_ml: 195,
      calories: 115,
      protein_g: 6,
      carbs_g: 9,
      fat_g: 5,
    },
    {
      name: "brewed coffee",
      weight_g: 75,
      volume_ml: 75,
      calories: 1,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    },
  ],
};

describe("toggleSelection", () => {
  it("flips toggle id in selection set", () => {
    expect(toggleSelection([], "added_sugar")).toEqual(["added_sugar"]);
    expect(toggleSelection(["added_sugar"], "added_sugar")).toEqual([]);
    expect(toggleSelection(["added_sugar"], "cream")).toEqual(["added_sugar", "cream"]);
  });
});

describe("clearToggles", () => {
  it("returns empty array", () => {
    expect(clearToggles()).toEqual([]);
  });
});

describe("buildClarifyPlan", () => {
  it("merges vision toggles with rule-based sugar for drinks", () => {
    const plan = buildClarifyPlan(drinkEstimate, { toggles: [], exclusive: null });
    expect(plan.toggles.some((t) => t.id === "added_sugar")).toBe(true);
  });

  it("includes vision-provided toggles", () => {
    const plan = buildClarifyPlan(drinkEstimate, {
      toggles: [{ id: "condensed_milk", label: "Condensed milk" }],
      exclusive: null,
    });
    expect(plan.toggles.some((t) => t.id === "condensed_milk")).toBe(true);
  });

  it("adds rule-based exclusive for fried food", () => {
    const fried: MacroEstimate = {
      ...drinkEstimate,
      description: "fried rice",
      portion: { container_type: "plate", container_volume_ml: null, fill_fraction: 1, notes: null },
      items: [{ name: "fried rice", weight_g: 300, calories: 450, protein_g: 10, carbs_g: 60, fat_g: 15 }],
    };
    const plan = buildClarifyPlan(fried, { toggles: [], exclusive: null });
    expect(plan.exclusive?.id).toBe("cooking_oil");
  });
});

describe("buildClarifyPrefetchCandidates", () => {
  it("includes visible draft and all toggle + exclusive templates", () => {
    const fried: MacroEstimate = {
      ...drinkEstimate,
      description: "fried rice",
      portion: { container_type: "plate", container_volume_ml: null, fill_fraction: 1, notes: null },
      items: [{ name: "fried rice", weight_g: 300, calories: 450, protein_g: 10, carbs_g: 60, fat_g: 15 }],
    };
    const plan = buildClarifyPlan(fried, {
      toggles: [
        { id: "added_sugar", label: "Sugar" },
        { id: "cream", label: "Cream" },
      ],
      exclusive: null,
    });
    const { visible, addOns } = buildClarifyPrefetchCandidates(fried, plan);
    expect(visible.items).toHaveLength(1);
    expect(addOns.map((a) => a.key)).toEqual(
      expect.arrayContaining(["added_sugar", "cream", "exclusive:light", "exclusive:medium", "exclusive:heavy"]),
    );
  });
});

describe("mergeClarifyIntoDraft", () => {
  it("adds sugar item when toggle selected", () => {
    const merged = mergeClarifyIntoDraft(drinkEstimate, ["added_sugar"], null);
    expect(merged.items.some((i) => i.name === "sugar")).toBe(true);
    expect(merged.calories).toBeGreaterThan(drinkEstimate.calories);
  });

  it("adds oil for exclusive heavy choice", () => {
    const fried: MacroEstimate = {
      ...drinkEstimate,
      description: "fried rice",
      portion: { container_type: "plate", container_volume_ml: null, fill_fraction: 1, notes: null },
      items: [{ name: "fried rice", weight_g: 300, calories: 450, protein_g: 10, carbs_g: 60, fat_g: 15 }],
    };
    const merged = mergeClarifyIntoDraft(fried, [], "heavy");
    expect(merged.items.some((i) => i.name === "cooking oil")).toBe(true);
    expect(merged.calories).toBeGreaterThan(450);
  });

  it("adds nothing when None (empty toggles, no exclusive)", () => {
    const merged = mergeClarifyIntoDraft(drinkEstimate, [], null);
    expect(merged.items).toHaveLength(drinkEstimate.items.length);
  });
});

describe("keyboards", () => {
  it("builds toggle keyboard with None and Calculate", () => {
    const plan = buildClarifyPlan(drinkEstimate, {
      toggles: [{ id: "added_sugar", label: "Sugar" }],
      exclusive: null,
    });
    const keyboard = buildToggleKeyboard(plan, ["added_sugar"]);
    const flat = keyboard.flat();
    expect(flat.some((b) => b.data === "meal:toggle:added_sugar" && b.label.includes("✓"))).toBe(true);
    expect(flat.some((b) => b.data === "meal:clarify:none")).toBe(true);
    expect(flat.some((b) => b.data === "meal:clarify:done")).toBe(true);
  });

  it("builds exclusive keyboard with None", () => {
    const fried: MacroEstimate = {
      ...drinkEstimate,
      description: "fried rice",
      portion: { container_type: "plate", container_volume_ml: null, fill_fraction: 1, notes: null },
      items: [{ name: "fried rice", weight_g: 300, calories: 450, protein_g: 10, carbs_g: 60, fat_g: 15 }],
    };
    const plan = buildClarifyPlan(fried, { toggles: [], exclusive: null });
    expect(plan.exclusive).not.toBeNull();
    const keyboard = buildExclusiveKeyboard(plan.exclusive!);
    expect(keyboard.flat().some((b) => b.data === "meal:exclusive:none")).toBe(true);
    expect(keyboard.flat().some((b) => b.data === "meal:exclusive:heavy")).toBe(true);
  });
});
