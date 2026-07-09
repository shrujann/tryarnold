import { z } from "zod";

export const foodItemSchema = z.object({
  name: z.string(),
  quantity: z.string().nullable().optional(),
  plate_share: z.number().nullable().optional(),
  calories: z.number().default(0),
  protein_g: z.number().default(0),
  carbs_g: z.number().default(0),
  fat_g: z.number().default(0),
});

export const macroEstimateSchema = z.object({
  items: z.array(foodItemSchema).default([]),
  calories: z.number().default(0),
  protein_g: z.number().default(0),
  carbs_g: z.number().default(0),
  fat_g: z.number().default(0),
  confidence: z.number().default(0),
  food_confidence: z.number().default(0),
  portion_confidence: z.number().default(0),
  assumptions: z.array(z.string()).default([]),
  description: z.string().default(""),
});

export type FoodItem = z.infer<typeof foodItemSchema>;
export type MacroEstimate = z.infer<typeof macroEstimateSchema>;

export function normalizeMacroEstimate(raw: MacroEstimate): MacroEstimate {
  const estimate = { ...raw };
  if (estimate.food_confidence || estimate.portion_confidence) {
    estimate.confidence = Math.min(
      estimate.food_confidence || 1,
      estimate.portion_confidence || 1,
    );
  }
  return estimate;
}

export function macroEstimateFromDict(payload: unknown): MacroEstimate {
  const parsed = macroEstimateSchema.parse(payload);
  return normalizeMacroEstimate(parsed);
}

export const macroEstimateFromJson = macroEstimateFromDict;

export function needsPortionConfirm(
  estimate: MacroEstimate,
  threshold: number,
): boolean {
  return estimate.portion_confidence < threshold;
}

export function applyMultiplier(
  estimate: MacroEstimate,
  factor: number,
): MacroEstimate {
  const scale = (n: number) => Math.round(n * factor * 10) / 10;
  return {
    ...estimate,
    items: estimate.items.map((item) => ({
      ...item,
      calories: scale(item.calories),
      protein_g: scale(item.protein_g),
      carbs_g: scale(item.carbs_g),
      fat_g: scale(item.fat_g),
    })),
    calories: scale(estimate.calories),
    protein_g: scale(estimate.protein_g),
    carbs_g: scale(estimate.carbs_g),
    fat_g: scale(estimate.fat_g),
  };
}
