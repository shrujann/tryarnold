import { describe, expect, it } from "vitest";
import { macroEstimateSchema } from "../src/schemas/nutrition";
import {
  editReviewButtons,
  formatEditReviewMessage,
  parseEditReviewAction,
  refineHighlightedChange,
} from "../src/services/meal-edit-review";

const estimate = macroEstimateSchema.parse({
  description: "burger with chicken patty",
  calories: 650,
  protein_g: 40,
  carbs_g: 45,
  fat_g: 28,
  portion_confidence: 0.8,
  food_confidence: 0.9,
  items: [
    {
      name: "chicken patty",
      weight_g: 120,
      calories: 280,
      protein_g: 25,
      carbs_g: 2,
      fat_g: 18,
    },
  ],
});

describe("parseEditReviewAction", () => {
  it("maps adjust confirm aliases", () => {
    expect(parseEditReviewAction("yes")).toBe("apply_edit");
    expect(parseEditReviewAction("Adjust")).toBe("apply_edit");
    expect(parseEditReviewAction("meal:apply_edit")).toBe("apply_edit");
  });

  it("maps edit-again aliases", () => {
    expect(parseEditReviewAction("edit")).toBe("edit_again");
    expect(parseEditReviewAction("no")).toBe("edit_again");
    expect(parseEditReviewAction("meal:edit_again")).toBe("edit_again");
  });

  it("ignores free-text meal corrections", () => {
    expect(parseEditReviewAction("the burger was with a chicken patty")).toBeNull();
  });
});

describe("formatEditReviewMessage", () => {
  it("highlights the called-out ingredient and asks to adjust", () => {
    const text = formatEditReviewMessage(
      {
        name: "chicken patty",
        calories: 280,
        protein_g: 25,
        carbs_g: 2,
        fat_g: 18,
      },
      estimate,
      "telegram",
    );

    expect(text).toContain("ah i see — <b>chicken patty</b> is ~280 kcal");
    expect(text).toContain("should i adjust the meal accordingly?");
    expect(text).toContain("updated meal would be");
  });
});

describe("editReviewButtons", () => {
  it("offers Adjust and Edit again", () => {
    expect(editReviewButtons()).toEqual([
      [
        { label: "Adjust", data: "meal:apply_edit" },
        { label: "Edit again", data: "meal:edit_again" },
      ],
    ]);
  });
});

describe("refineHighlightedChange", () => {
  it("prefers enriched item macros when names match", () => {
    const refined = refineHighlightedChange(
      {
        name: "chicken patty",
        calories: 999,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 1,
      },
      estimate,
    );
    expect(refined).toEqual({
      name: "chicken patty",
      calories: 280,
      protein_g: 25,
      carbs_g: 2,
      fat_g: 18,
    });
  });
});
