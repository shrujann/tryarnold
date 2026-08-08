import { describe, expect, it } from "vitest";
import {
  buildDailyReportPdf,
  formatReportDateLabel,
  mealEstimateFromRow,
} from "../src/services/daily-report-pdf";
import type { MealRow } from "../src/db/meals";
import type { DailyProgress } from "../src/db/users";

const progress: DailyProgress = {
  calories: 850,
  protein_g: 55,
  carbs_g: 70,
  fat_g: 30,
  meals: 2,
  target_calories: 2000,
  target_protein_g: 150,
  target_carbs_g: 200,
  target_fat_g: 60,
  remaining_calories: 1150,
  remaining_protein_g: 95,
  remaining_carbs_g: 130,
  remaining_fat_g: 30,
};

function meal(partial: Partial<MealRow> & Pick<MealRow, "id" | "description">): MealRow {
  return {
    user_id: 1,
    ts: "2026-08-08T04:30:00.000Z",
    source: "photo",
    calories: 400,
    protein_g: 20,
    carbs_g: 30,
    fat_g: 15,
    confidence: 0.8,
    items_json: JSON.stringify([
      {
        name: "chicken",
        weight_g: 120,
        calories: 200,
        protein_g: 30,
        carbs_g: 0,
        fat_g: 8,
      },
      {
        name: "rice",
        weight_g: 150,
        calories: 200,
        protein_g: 4,
        carbs_g: 40,
        fat_g: 1,
      },
    ]),
    media_ref: null,
    media_unique_ref: null,
    photo_caption: null,
    ...partial,
  };
}

describe("buildDailyReportPdf", () => {
  it("produces a PDF with the expected header structure", async () => {
    const meals = [
      meal({ id: 1, description: "chicken rice" }),
      meal({
        id: 2,
        description: "yogurt",
        ts: "2026-08-08T08:00:00.000Z",
        calories: 150,
        protein_g: 12,
        carbs_g: 15,
        fat_g: 4,
        items_json: JSON.stringify([]),
      }),
    ];

    const bytes = await buildDailyReportPdf({
      dateLabel: formatReportDateLabel("UTC", new Date("2026-08-08T12:00:00Z")),
      timezone: "UTC",
      progress,
      meals: meals.map((row) => ({
        meal: row,
        estimate: mealEstimateFromRow(row),
        timeLabel: "12:30",
        image: null,
      })),
    });

    expect(bytes.byteLength).toBeGreaterThan(500);
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    expect(head).toBe("%PDF-");
  });
});
