import { describe, expect, it } from "vitest";
import {
  formatMealConfirmMessage,
  formatMealLoggedMessage,
  getDisplayableItems,
} from "../src/services/meal-format";
import type { MacroEstimate } from "../src/schemas/nutrition";

const icedCoffee: MacroEstimate = {
  description: "iced coffee",
  confidence: 0.8,
  food_confidence: 0.8,
  portion_confidence: 0.7,
  assumptions: [],
  calories: 250,
  protein_g: 7,
  carbs_g: 18,
  fat_g: 12,
  items: [
    {
      name: "coffee",
      weight_g: 75,
      volume_ml: 75,
      calories: 120,
      protein_g: 1,
      carbs_g: 10,
      fat_g: 0,
    },
    {
      name: "whole milk",
      weight_g: 260,
      volume_ml: 260,
      calories: 100,
      protein_g: 5,
      carbs_g: 6,
      fat_g: 5,
    },
    {
      name: "sugar substitute",
      calories: 30,
      protein_g: 0,
      carbs_g: 2,
      fat_g: 0,
    },
  ],
};

const lowKcalCoffee: MacroEstimate = {
  description: "iced coffee with milk",
  confidence: 0.8,
  food_confidence: 0.8,
  portion_confidence: 0.7,
  assumptions: [],
  calories: 145,
  protein_g: 8,
  carbs_g: 12,
  fat_g: 8,
  items: [
    {
      name: "whole milk",
      weight_g: 237,
      volume_ml: 237,
      calories: 144,
      protein_g: 7,
      carbs_g: 11,
      fat_g: 8,
    },
    {
      name: "brewed coffee",
      weight_g: 141,
      volume_ml: 141,
      calories: 1,
      protein_g: 0.1,
      carbs_g: 0,
      fat_g: 0,
    },
  ],
};

const singleApple: MacroEstimate = {
  description: "apple",
  confidence: 0.8,
  food_confidence: 0.8,
  portion_confidence: 0.9,
  assumptions: [],
  calories: 95,
  protein_g: 0.5,
  carbs_g: 25,
  fat_g: 0.3,
  items: [{ name: "apple", calories: 95, protein_g: 0.5, carbs_g: 25, fat_g: 0.3 }],
};

describe("getDisplayableItems", () => {
  it("returns 2+ significant items for breakdown", () => {
    expect(getDisplayableItems(icedCoffee.items)).toHaveLength(3);
  });

  it("includes low-kcal items when they have volume_ml", () => {
    expect(getDisplayableItems(lowKcalCoffee.items)).toHaveLength(2);
  });

  it("excludes negligible ice from breakdown", () => {
    const items = [
      { name: "coffee", calories: 120, protein_g: 0, carbs_g: 0, fat_g: 0, weight_g: 75, volume_ml: 75 },
      { name: "ice", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    ];
    expect(getDisplayableItems(items)).toHaveLength(0);
  });
});

describe("formatMealConfirmMessage", () => {
  it("includes ingredient breakdown for multi-item meals", () => {
    const msg = formatMealConfirmMessage(icedCoffee, {
      channel: "line",
      portionUnclear: false,
    });
    expect(msg).toContain("iced coffee");
    expect(msg).toContain("P7 C18 F12");
    expect(msg).toContain("• coffee — 75 ml (~120 kcal)");
    expect(msg).toContain("• whole milk — 260 ml (~100 kcal)");
    expect(msg).toContain("tap to log, edit, or skip.");
  });

  it("shows breakdown with ~1 kcal coffee when volume present", () => {
    const msg = formatMealConfirmMessage(lowKcalCoffee, {
      channel: "line",
      portionUnclear: false,
    });
    expect(msg).toContain("• brewed coffee — 141 ml (~1 kcal)");
    expect(msg).toContain("• whole milk — 237 ml (~144 kcal)");
  });

  it("omits breakdown for single-item meals", () => {
    const msg = formatMealConfirmMessage(singleApple, {
      channel: "line",
      portionUnclear: false,
    });
    expect(msg).not.toContain("•");
    expect(msg).toContain("apple");
  });

  it("uses HTML bold for telegram", () => {
    const msg = formatMealConfirmMessage(icedCoffee, {
      channel: "telegram",
      portionUnclear: false,
    });
    expect(msg).toContain("<b>iced coffee</b>");
    expect(msg).not.toContain("<b>coffee</b>");
  });

  it("matches line text aside from telegram HTML tags", () => {
    const lineMsg = formatMealConfirmMessage(icedCoffee, {
      channel: "line",
      portionUnclear: false,
    });
    const telegramMsg = formatMealConfirmMessage(icedCoffee, {
      channel: "telegram",
      portionUnclear: false,
    });
    expect(telegramMsg.replace(/<\/?b>/g, "")).toBe(lineMsg);
  });

  it("shows portion unclear copy when requested", () => {
    const msg = formatMealConfirmMessage(icedCoffee, {
      channel: "line",
      portionUnclear: true,
      remainingSuffix: " (2000 kcal left after this)",
    });
    expect(msg).toContain("around 250 kcal");
    expect(msg).toContain("portion's unclear");
  });
});

describe("formatMealLoggedMessage", () => {
  it("includes meal name with total calories and macros", () => {
    const msg = formatMealLoggedMessage(icedCoffee, { channel: "line" });
    expect(msg).toBe("logged iced coffee — 250 kcal (P7 C18 F12)");
    expect(msg).not.toContain("•");
  });

  it("uses HTML bold for telegram", () => {
    const msg = formatMealLoggedMessage(icedCoffee, { channel: "telegram" });
    expect(msg).toBe("logged <b>iced coffee</b> — 250 kcal (P7 C18 F12)");
  });
});
