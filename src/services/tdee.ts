export type Gender = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type FitnessGoal = "lose_weight" | "maintain" | "gain_muscle";

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const CALORIE_FLOORS: Record<Gender, number> = {
  female: 1200,
  male: 1500,
};

const PROTEIN_G_PER_KG: Record<FitnessGoal, number> = {
  lose_weight: 2.2,
  maintain: 1.8,
  gain_muscle: 2.0,
};

export interface ProfileInput {
  gender: Gender;
  age: number;
  weightKg: number;
  heightCm: number;
  activityLevel: ActivityLevel;
  fitnessGoal: FitnessGoal;
}

export interface MacroTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Mifflin-St Jeor BMR (kcal/day). */
export function computeBmr(input: Pick<ProfileInput, "gender" | "age" | "weightKg" | "heightCm">): number {
  const { gender, age, weightKg, heightCm } = input;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return gender === "male" ? base + 5 : base - 161;
}

export function computeTdee(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activityLevel];
}

export function computeCalorieTarget(
  tdee: number,
  fitnessGoal: FitnessGoal,
  gender: Gender,
): number {
  let target: number;
  switch (fitnessGoal) {
    case "lose_weight":
      target = tdee - 500;
      break;
    case "gain_muscle":
      target = tdee + 300;
      break;
    default:
      target = tdee;
  }
  return Math.round(Math.max(target, CALORIE_FLOORS[gender]));
}

export function computeMacroTargets(
  calorieTarget: number,
  weightKg: number,
  fitnessGoal: FitnessGoal,
): MacroTargets {
  const protein_g = Math.round(weightKg * PROTEIN_G_PER_KG[fitnessGoal]);
  const fat_g = Math.round((calorieTarget * 0.25) / 9);
  const proteinCal = protein_g * 4;
  const fatCal = fat_g * 9;
  const carbs_g = Math.max(0, Math.round((calorieTarget - proteinCal - fatCal) / 4));

  return {
    calories: calorieTarget,
    protein_g,
    carbs_g,
    fat_g,
  };
}

export function computeFullTargets(input: ProfileInput): {
  bmr: number;
  tdee: number;
  targets: MacroTargets;
} {
  const bmr = computeBmr(input);
  const tdee = computeTdee(bmr, input.activityLevel);
  const calories = computeCalorieTarget(tdee, input.fitnessGoal, input.gender);
  const targets = computeMacroTargets(calories, input.weightKg, input.fitnessGoal);
  return { bmr, tdee, targets };
}

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "sedentary (desk job)",
  light: "light (1-3 days/wk)",
  moderate: "moderate (3-5 days/wk)",
  active: "active (6-7 days/wk)",
  very_active: "very active (physical job)",
};

export const GOAL_LABELS: Record<FitnessGoal, string> = {
  lose_weight: "lose weight",
  maintain: "maintain",
  gain_muscle: "gain muscle",
};
