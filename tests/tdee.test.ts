import { describe, expect, it } from "vitest";
import {
  ACTIVITY_MULTIPLIERS,
  computeBmr,
  computeCalorieTarget,
  computeFullTargets,
  computeMacroTargets,
  computeTdee,
} from "../src/services/tdee";

describe("computeBmr", () => {
  it("uses Mifflin-St Jeor for male", () => {
    const bmr = computeBmr({
      gender: "male",
      age: 30,
      weightKg: 80,
      heightCm: 180,
    });
    expect(bmr).toBeCloseTo(1780, 0);
  });

  it("uses Mifflin-St Jeor for female", () => {
    const bmr = computeBmr({
      gender: "female",
      age: 30,
      weightKg: 65,
      heightCm: 165,
    });
    expect(bmr).toBeCloseTo(1370, 0);
  });
});

describe("computeTdee", () => {
  it("applies activity multipliers", () => {
    const bmr = 1500;
    expect(computeTdee(bmr, "sedentary")).toBe(1800);
    expect(computeTdee(bmr, "moderate")).toBe(2325);
    expect(computeTdee(bmr, "very_active")).toBe(2850);
  });

  it("covers all activity levels", () => {
    for (const [level, mult] of Object.entries(ACTIVITY_MULTIPLIERS)) {
      expect(computeTdee(1000, level as keyof typeof ACTIVITY_MULTIPLIERS)).toBe(
        1000 * mult,
      );
    }
  });
});

describe("computeCalorieTarget", () => {
  it("applies deficit for lose weight with female floor", () => {
    expect(computeCalorieTarget(1400, "lose_weight", "female")).toBe(1200);
  });

  it("applies deficit for lose weight with male floor", () => {
    expect(computeCalorieTarget(1600, "lose_weight", "male")).toBe(1500);
  });

  it("applies surplus for gain muscle", () => {
    expect(computeCalorieTarget(2500, "gain_muscle", "male")).toBe(2800);
  });

  it("maintains at tdee", () => {
    expect(computeCalorieTarget(2200, "maintain", "female")).toBe(2200);
  });
});

describe("computeMacroTargets", () => {
  it("returns protein, fat, and carb grams", () => {
    const macros = computeMacroTargets(2000, 75, "maintain");
    expect(macros.calories).toBe(2000);
    expect(macros.protein_g).toBe(135);
    expect(macros.fat_g).toBe(56);
    expect(macros.carbs_g).toBeGreaterThan(0);
    const total =
      macros.protein_g * 4 + macros.carbs_g * 4 + macros.fat_g * 9;
    expect(total).toBeLessThanOrEqual(2000 + 4);
  });
});

describe("computeFullTargets", () => {
  it("produces consistent bmr, tdee, and macro targets", () => {
    const result = computeFullTargets({
      gender: "male",
      age: 28,
      weightKg: 78,
      heightCm: 178,
      activityLevel: "moderate",
      fitnessGoal: "lose_weight",
    });
    expect(result.bmr).toBeGreaterThan(1500);
    expect(result.tdee).toBeGreaterThan(result.bmr);
    expect(result.targets.calories).toBeGreaterThanOrEqual(1500);
    expect(result.targets.protein_g).toBeGreaterThan(0);
  });
});
