import { z } from "zod";

export const containerTypeSchema = z.enum([
  "cup",
  "plate",
  "bowl",
  "packaged",
  "unknown",
]);

export const portionSchema = z.object({
  container_type: containerTypeSchema.default("unknown"),
  container_volume_ml: z.number().nullable().optional(),
  fill_fraction: z.number().default(1),
  notes: z.string().nullable().optional(),
});

export const foodItemSchema = z.object({
  name: z.string(),
  quantity: z.string().nullable().optional(),
  plate_share: z.number().nullable().optional(),
  weight_g: z.number().default(0),
  volume_ml: z.number().nullable().optional(),
  volume_fraction: z.number().nullable().optional(),
  calories: z.number().default(0),
  protein_g: z.number().default(0),
  carbs_g: z.number().default(0),
  fat_g: z.number().default(0),
});

export const macroEstimateSchema = z.object({
  items: z.array(foodItemSchema).default([]),
  portion: portionSchema.optional(),
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

export type PortionEstimate = z.infer<typeof portionSchema>;
export type FoodItem = z.infer<typeof foodItemSchema>;
export type MacroEstimate = z.infer<typeof macroEstimateSchema>;

/** Strict schema for LLM structured output (all macro fields required). */
export const strictFoodItemSchema = z.object({
  name: z.string(),
  quantity: z.string().nullable().optional(),
  plate_share: z.number().nullable().optional(),
  weight_g: z.number(),
  volume_ml: z.number().nullable().optional(),
  volume_fraction: z.number().nullable().optional(),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
});

export const strictPortionSchema = z.object({
  container_type: containerTypeSchema,
  container_volume_ml: z.number().nullable(),
  fill_fraction: z.number(),
  notes: z.string().nullable(),
});

export const clarifyToggleSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const clarifyExclusiveOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

export const clarifyExclusiveSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  options: z.array(clarifyExclusiveOptionSchema),
});

export const clarificationSpecSchema = z.object({
  toggles: z.array(clarifyToggleSchema).default([]),
  exclusive: clarifyExclusiveSchema.nullable().default(null),
});

export type ClarifyToggle = z.infer<typeof clarifyToggleSchema>;
export type ClarifyExclusive = z.infer<typeof clarifyExclusiveSchema>;
export type ClarificationSpec = z.infer<typeof clarificationSpecSchema>;

export const strictMacroEstimateSchema = z.object({
  items: z.array(strictFoodItemSchema),
  portion: strictPortionSchema,
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  confidence: z.number(),
  food_confidence: z.number(),
  portion_confidence: z.number(),
  assumptions: z.array(z.string()),
  description: z.string(),
});

/** Strict schema for vision LLM output (includes clarification spec). */
export const strictVisionOutputSchema = strictMacroEstimateSchema.extend({
  clarification: clarificationSpecSchema,
});

export type VisionOutput = z.infer<typeof strictVisionOutputSchema>;

/** Strip vision-only clarification before persisting a meal estimate. */
export function stripClarificationFromEstimate(
  raw: MacroEstimate & { clarification?: ClarificationSpec | null },
): MacroEstimate {
  const { clarification: _clarification, ...estimate } = raw;
  return estimate;
}

function roundMacro(n: number): number {
  return Math.round(n * 10) / 10;
}

function sumItemMacros(items: FoodItem[]): Pick<
  MacroEstimate,
  "calories" | "protein_g" | "carbs_g" | "fat_g"
> {
  return items.reduce(
    (acc, item) => ({
      calories: roundMacro(acc.calories + item.calories),
      protein_g: roundMacro(acc.protein_g + item.protein_g),
      carbs_g: roundMacro(acc.carbs_g + item.carbs_g),
      fat_g: roundMacro(acc.fat_g + item.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

function scaleItemFields(item: FoodItem, factor: number): FoodItem {
  if (factor >= 0.999 && factor <= 1.001) return item;
  const scale = (n: number) => roundMacro(n * factor);
  return {
    ...item,
    weight_g: scale(item.weight_g),
    volume_ml:
      item.volume_ml != null ? scale(item.volume_ml) : item.volume_ml,
    calories: scale(item.calories),
    protein_g: scale(item.protein_g),
    carbs_g: scale(item.carbs_g),
    fat_g: scale(item.fat_g),
  };
}

/** Cap liquid volumes to container capacity; recompute meal totals from items. */
export function normalizePortionEstimate(raw: MacroEstimate): MacroEstimate {
  const estimate: MacroEstimate = {
    ...raw,
    portion: raw.portion
      ? {
          container_type: raw.portion.container_type ?? "unknown",
          container_volume_ml: raw.portion.container_volume_ml ?? null,
          fill_fraction: raw.portion.fill_fraction ?? 1,
          notes: raw.portion.notes ?? null,
        }
      : undefined,
    items: (raw.items ?? []).map((item) => ({
      ...item,
      weight_g: item.weight_g ?? 0,
    })),
    assumptions: [...(raw.assumptions ?? [])],
  };

  const portion = estimate.portion;
  if (!portion?.container_volume_ml || portion.container_volume_ml <= 0) {
    if (estimate.items.length > 0) {
      const totals = sumItemMacros(estimate.items);
      return { ...estimate, ...totals };
    }
    return estimate;
  }

  const maxLiquidMl = roundMacro(
    portion.container_volume_ml * (portion.fill_fraction ?? 1),
  );
  if (maxLiquidMl <= 0) return estimate;

  let totalLiquidMl = 0;
  for (const item of estimate.items) {
    if (item.volume_ml != null && item.volume_ml > 0) {
      totalLiquidMl += item.volume_ml;
    }
  }

  const volumeFractionSum = estimate.items.reduce(
    (sum, item) => sum + (item.volume_fraction ?? 0),
    0,
  );
  if (volumeFractionSum > 1.05) {
    estimate.portion_confidence = Math.min(estimate.portion_confidence, 0.4);
    if (
      !estimate.assumptions.some((a) =>
        a.startsWith("portion: liquid fractions exceed container"),
      )
    ) {
      estimate.assumptions.push(
        "portion: liquid fractions exceed container",
      );
    }
  }

  if (totalLiquidMl > maxLiquidMl && totalLiquidMl > 0) {
    const factor = maxLiquidMl / totalLiquidMl;
    estimate.items = estimate.items.map((item) => {
      if (item.volume_ml == null || item.volume_ml <= 0) return item;
      return scaleItemFields(item, factor);
    });
    if (
      !estimate.assumptions.some((a) =>
        a.startsWith("portion: capped liquid volume to container"),
      )
    ) {
      estimate.assumptions.push(
        `portion: capped liquid volume to container (${maxLiquidMl} ml)`,
      );
    }
  }

  const totals = sumItemMacros(estimate.items);
  return { ...estimate, ...totals };
}

export function normalizeMacroEstimate(raw: MacroEstimate): MacroEstimate {
  const withPortion = normalizePortionEstimate(raw);
  const estimate = { ...withPortion };
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
    portion: estimate.portion
      ? {
          ...estimate.portion,
          container_volume_ml:
            estimate.portion.container_volume_ml != null
              ? scale(estimate.portion.container_volume_ml)
              : null,
        }
      : undefined,
    items: estimate.items.map((item) => ({
      ...item,
      weight_g: scale(item.weight_g),
      volume_ml: item.volume_ml != null ? scale(item.volume_ml) : item.volume_ml,
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
