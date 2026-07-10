import { HumanMessage } from "@langchain/core/messages";
import type { Env } from "../env";
import { getSettings } from "../config";
import {
  macroEstimateSchema,
  normalizeMacroEstimate,
  strictMacroEstimateSchema,
  type MacroEstimate,
} from "../schemas/nutrition";
import { createVisionModel } from "./llm";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function hasNamedItemsButZeroMacros(estimate: {
  items?: Array<{ name?: string | null }>;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
}): boolean {
  const hasItems = (estimate.items ?? []).some((item) => Boolean(item.name?.trim()));
  const allZero =
    Number(estimate.calories ?? 0) === 0 &&
    Number(estimate.protein_g ?? 0) === 0 &&
    Number(estimate.carbs_g ?? 0) === 0 &&
    Number(estimate.fat_g ?? 0) === 0;
  return hasItems && allZero;
}

export async function estimateFromImage(
  env: Env,
  imageBytes: Uint8Array,
  mime: string,
  caption?: string | null,
): Promise<MacroEstimate> {
  const settings = getSettings(env);
  if (!settings.aiEnabled) {
    return normalizeMacroEstimate({
      description: caption || "food photo",
      confidence: 0,
      assumptions: ["AI vision disabled"],
      items: [],
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      food_confidence: 0,
      portion_confidence: 0,
    });
  }

  const visionModel = createVisionModel(env).withStructuredOutput(strictMacroEstimateSchema, {
    name: "meal_estimate",
    method: "functionCalling",
    strict: true,
  });

  let prompt =
    "Identify this meal and estimate nutrition for the full plate. Return compact JSON with " +
    "description, calories, protein_g, carbs_g, fat_g, food_confidence, portion_confidence, " +
    "assumptions (array), items (max 3 with name, quantity, plate_share, calories, protein_g, " +
    "carbs_g, fat_g). quantity descriptive only. Use best-effort numeric estimates. Do not leave " +
    "calories or macros at 0 unless the food is genuinely negligible-calorie.";
  if (caption) prompt += ` User note: ${caption}`;

  const b64 = bytesToBase64(imageBytes);
  const dataUrl = `data:${mime};base64,${b64}`;

  try {
    const invokeEstimate = async (instruction: string) =>
      visionModel.invoke([
        new HumanMessage({
          content: [
            { type: "text", text: instruction },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }),
      ]);

    let result = await invokeEstimate(prompt);
    strictMacroEstimateSchema.parse(result);
    if (hasNamedItemsButZeroMacros(result)) {
      const retryPrompt =
        "You already identified a plated meal. Re-estimate the nutrition for the whole plate and " +
        "for each listed item. All calorie and macro fields must be best-effort numeric estimates, " +
        "not placeholders. Use 0 only if the pictured food is truly negligible-calorie. Keep the " +
        "same JSON shape.";
      result = await invokeEstimate(retryPrompt);
      strictMacroEstimateSchema.parse(result);
    }
    return normalizeMacroEstimate(macroEstimateSchema.parse(result));
  } catch (err) {
    console.error("Vision estimate failed", err);
    return normalizeMacroEstimate({
      description: caption || "food photo",
      confidence: 0.2,
      assumptions: ["vision structured output failed"],
      items: [],
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      food_confidence: 0,
      portion_confidence: 0,
    });
  }
}
