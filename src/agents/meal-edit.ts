import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { Env } from "../env";
import { getSettings } from "../config";
import {
  macroEstimateSchema,
  normalizeMacroEstimate,
  strictMacroEstimateSchema,
  type MacroEstimate,
} from "../schemas/nutrition";
import { createChatModel } from "./llm";
import type { HighlightedChange } from "../services/meal-edit-review";

const highlightedChangeSchema = z.object({
  name: z.string(),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
});

const mealEditOutputSchema = z.object({
  estimate: strictMacroEstimateSchema,
  highlighted_change: highlightedChangeSchema.nullable(),
});

export type MealEditResult = {
  estimate: MacroEstimate;
  highlighted_change: HighlightedChange | null;
};

export async function applyMealEdit(
  env: Env,
  current: MacroEstimate,
  instruction: string,
): Promise<MealEditResult> {
  const settings = getSettings(env);
  if (!settings.aiEnabled) {
    return { estimate: current, highlighted_change: null };
  }

  const model = createChatModel(env).withStructuredOutput(mealEditOutputSchema, {
    name: "meal_edit",
    method: "functionCalling",
    strict: true,
  });

  const prompt =
    "Update this meal nutrition estimate based on the user's edit instruction. " +
    "Preserve portion block and weight_g / volume_ml when still accurate. " +
    "Return the full updated estimate JSON in `estimate`.\n\n" +
    "Also set `highlighted_change` to the main food/ingredient the user called out " +
    "(e.g. if they said the burger has a chicken patty, highlight chicken patty with that item's macros). " +
    "Use null only when the edit is a vague portion tweak with no distinct item.\n\n" +
    `Current estimate:\n${JSON.stringify(current)}\n\n` +
    `User edit: ${instruction}`;

  const result = mealEditOutputSchema.parse(
    await model.invoke([new HumanMessage(prompt)]),
  );
  const estimate = normalizeMacroEstimate(
    macroEstimateSchema.parse(result.estimate),
  );

  return {
    estimate,
    highlighted_change: result.highlighted_change,
  };
}
