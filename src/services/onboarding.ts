import type { ActivityLevel, FitnessGoal, Gender } from "./tdee";
import { ACTIVITY_LABELS, GOAL_LABELS } from "./tdee";
import type { UnitPreference } from "./units";

export const ONBOARDING_STEPS = [
  "unit",
  "gender",
  "age",
  "weight",
  "height",
  "activity",
  "goal",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function nextOnboardingStep(current: OnboardingStep): OnboardingStep | "done" {
  const idx = ONBOARDING_STEPS.indexOf(current);
  if (idx < 0 || idx >= ONBOARDING_STEPS.length - 1) return "done";
  return ONBOARDING_STEPS[idx + 1]!;
}

export interface OnboardAction {
  step: OnboardingStep;
  value: string;
}

export function normalizeOnboardAction(text: string): OnboardAction | null {
  const token = text.trim().toLowerCase();
  if (!token.startsWith("onboard:")) return null;

  const body = token.slice("onboard:".length);
  const sep = body.indexOf("_");
  if (sep <= 0) return null;

  const step = body.slice(0, sep) as OnboardingStep;
  const value = body.slice(sep + 1);
  if (!ONBOARDING_STEPS.includes(step) || !value) return null;
  return { step, value };
}

export function isOnboardingStep(value: string | null | undefined): value is OnboardingStep {
  return ONBOARDING_STEPS.includes(value as OnboardingStep);
}

export function hasStartedOnboarding(user: {
  onboarding_step?: string | null;
}): boolean {
  return isOnboardingStep(user.onboarding_step);
}

export const LINE_FOLLOW_PROMPT =
  "hey, i'm arnold, your nutrition coach.\n\ntype /start to set up your calorie targets and start tracking.";

export const START_REQUIRED_PROMPT = "type /start to begin setup.";

export function unitFromAction(value: string): UnitPreference | null {
  if (value === "metric" || value === "imperial") return value;
  return null;
}

export function genderFromAction(value: string): Gender | null {
  if (value === "male" || value === "female") return value;
  return null;
}

export function activityFromAction(value: string): ActivityLevel | null {
  const levels: ActivityLevel[] = [
    "sedentary",
    "light",
    "moderate",
    "active",
    "very_active",
  ];
  return levels.includes(value as ActivityLevel) ? (value as ActivityLevel) : null;
}

export function goalFromAction(value: string): FitnessGoal | null {
  const goals: FitnessGoal[] = ["lose_weight", "maintain", "gain_muscle"];
  return goals.includes(value as FitnessGoal) ? (value as FitnessGoal) : null;
}

export function stepPrompt(step: OnboardingStep, unitPref: UnitPreference = "metric"): string {
  switch (step) {
    case "unit":
      return "first, which units do you prefer?";
    case "gender":
      return "what's your biological sex? (used for calorie math)";
    case "age":
      return "how old are you? (years)";
    case "weight":
      return unitPref === "imperial"
        ? "what's your current weight? (e.g. 165 lbs)"
        : "what's your current weight? (e.g. 70 kg)";
    case "height":
      return unitPref === "imperial"
        ? "what's your height? (e.g. 5'10 or 70 in)"
        : "what's your height? (e.g. 175 cm)";
    case "activity":
      return "how active are you day to day?";
    case "goal":
      return "what's your main goal right now?";
    default:
      return "let's finish your setup.";
  }
}

export function stepButtons(step: OnboardingStep): Array<Array<{ label: string; data: string }>> {
  switch (step) {
    case "unit":
      return [
        [
          { label: "Metric (kg, cm)", data: "onboard:unit_metric" },
          { label: "Imperial (lbs, ft)", data: "onboard:unit_imperial" },
        ],
      ];
    case "gender":
      return [
        [
          { label: "Female", data: "onboard:gender_female" },
          { label: "Male", data: "onboard:gender_male" },
        ],
      ];
    case "activity":
      return [
        [{ label: "Sedentary", data: "onboard:activity_sedentary" }],
        [{ label: "Light", data: "onboard:activity_light" }],
        [{ label: "Moderate", data: "onboard:activity_moderate" }],
        [{ label: "Active", data: "onboard:activity_active" }],
        [{ label: "Very active", data: "onboard:activity_very_active" }],
      ];
    case "goal":
      return [
        [{ label: "Lose weight", data: "onboard:goal_lose_weight" }],
        [{ label: "Maintain", data: "onboard:goal_maintain" }],
        [{ label: "Gain muscle", data: "onboard:goal_gain_muscle" }],
      ];
    default:
      return [];
  }
}

export function goalSummaryLabel(goal: FitnessGoal): string {
  return GOAL_LABELS[goal];
}

export function activitySummaryLabel(level: ActivityLevel): string {
  return ACTIVITY_LABELS[level];
}
