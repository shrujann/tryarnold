import { describe, expect, it } from "vitest";
import { expandCompoundItems } from "../src/services/item-split";

describe("expandCompoundItems", () => {
  it("splits espresso with sweetener into coffee and sugar substitute", () => {
    const { items, splitNotes } = expandCompoundItems([
      {
        name: "espresso with sweetener",
        calories: 150,
        protein_g: 1,
        carbs_g: 20,
        fat_g: 2,
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]!.name).toBe("coffee");
    expect(items[1]!.name).toBe("sugar substitute");
    expect(items[0]!.calories).toBe(127.5);
    expect(items[1]!.calories).toBe(22.5);
    expect(items.reduce((s, i) => s + i.calories, 0)).toBe(150);
    expect(splitNotes[0]).toContain("split:");
  });

  it("splits coffee and milk equally", () => {
    const { items } = expandCompoundItems([
      {
        name: "coffee and milk",
        calories: 200,
        protein_g: 4,
        carbs_g: 10,
        fat_g: 6,
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]!.calories).toBe(100);
    expect(items[1]!.calories).toBe(100);
    expect(items[0]!.protein_g).toBe(2);
    expect(items[1]!.protein_g).toBe(2);
  });

  it("splits weight_g and volume_ml alongside macros", () => {
    const { items } = expandCompoundItems([
      {
        name: "coffee and milk",
        weight_g: 300,
        volume_ml: 300,
        volume_fraction: 0.8,
        calories: 200,
        protein_g: 4,
        carbs_g: 10,
        fat_g: 6,
      },
    ]);

    expect(items).toHaveLength(2);
    expect(items.reduce((s, i) => s + i.weight_g, 0)).toBe(300);
    expect(items.reduce((s, i) => s + (i.volume_ml ?? 0), 0)).toBe(300);
    expect(items.reduce((s, i) => s + i.calories, 0)).toBe(200);
  });

  it("passes through atomic items with alias applied", () => {
    const { items, splitNotes } = expandCompoundItems([
      {
        name: "espresso",
        calories: 5,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("coffee");
    expect(splitNotes).toHaveLength(0);
  });

  it("caps at 5 items by merging negligible entries", () => {
    const { items } = expandCompoundItems([
      { name: "rice", calories: 200, protein_g: 4, carbs_g: 40, fat_g: 1 },
      { name: "chicken", calories: 180, protein_g: 30, carbs_g: 0, fat_g: 5 },
      { name: "broccoli", calories: 40, protein_g: 3, carbs_g: 6, fat_g: 0 },
      { name: "carrots", calories: 35, protein_g: 1, carbs_g: 8, fat_g: 0 },
      { name: "peas", calories: 30, protein_g: 2, carbs_g: 5, fat_g: 0 },
      { name: "ice", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      { name: "water", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    ]);

    expect(items.length).toBeLessThanOrEqual(5);
  });
});
