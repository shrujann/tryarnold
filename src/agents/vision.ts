import { HumanMessage } from "@langchain/core/messages";
import type { Env } from "../env";
import { getSettings } from "../config";
import {
  macroEstimateSchema,
  normalizeMacroEstimate,
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

  const visionModel = createVisionModel(env).withStructuredOutput(macroEstimateSchema, {
    name: "meal_estimate",
    method: "jsonSchema",
    strict: true,
  });

  let prompt =
    "Identify this meal. Return compact JSON with description, calories, protein_g, carbs_g, fat_g, " +
    "food_confidence, portion_confidence, assumptions (array), items (max 3 with name, quantity, " +
    "plate_share, calories, protein_g, carbs_g, fat_g). quantity descriptive only.";
  if (caption) prompt += ` User note: ${caption}`;

  const b64 = bytesToBase64(imageBytes);
  const dataUrl = `data:${mime};base64,${b64}`;

  try {
    const result = await visionModel.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }),
    ]);
    return normalizeMacroEstimate(macroEstimateSchema.parse(result));
  } catch {
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
