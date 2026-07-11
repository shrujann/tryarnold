import { HumanMessage } from "@langchain/core/messages";
import type { Env } from "../env";
import { getSettings } from "../config";
import {
  clarificationSpecSchema,
  macroEstimateSchema,
  normalizeMacroEstimate,
  strictVisionOutputSchema,
  stripClarificationFromEstimate,
  type ClarificationSpec,
  type MacroEstimate,
} from "../schemas/nutrition";
import { createVisionModel } from "./llm";
import { createLogger } from "../services/logger";

export type VisionResult = {
  estimate: MacroEstimate;
  clarification: ClarificationSpec;
};

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

const VISION_PROMPT =
  "Estimate nutrition from this food photo. Return JSON with description, portion, items, " +
  "calories, protein_g, carbs_g, fat_g, food_confidence, portion_confidence, assumptions, clarification.\n\n" +
  "STEP 1 — PORTION (write to `portion` first):\n" +
  "- container_type: cup | plate | bowl | packaged | unknown\n" +
  "- container_volume_ml: drink capacity (medium takeaway cup ~350–450 ml; null for plates)\n" +
  "- fill_fraction: 0–1 how full (account for ice headspace; layered iced drink ~0.7–0.8)\n" +
  "- notes: brief size cue (e.g. 'medium plastic cup, 12–16 oz')\n\n" +
  "STEP 2 — VISIBLE COMPONENTS ONLY (max 5 atomic items, one food per item):\n" +
  "- List ONLY what is clearly visible. No condensed milk, syrup, or sugar unless clearly present.\n" +
  "- For layered drinks: separate coffee and milk with volume_fraction matching visible layers.\n" +
  "- Each item: name, quantity, weight_g (required), volume_ml (liquids), volume_fraction (of container), " +
  "plate_share, calories, protein_g, carbs_g, fat_g.\n" +
  "- For milk/coffee: weight_g ≈ volume_ml (1 ml ≈ 1 g). Ice/water: weight_g 0 if negligible.\n\n" +
  "STEP 3 — MACROS:\n" +
  "- Per-item macros consistent with weight_g; item totals ≈ meal totals.\n\n" +
  "STEP 4 — CLARIFICATION (vision-only; do NOT add hidden items to `items`):\n" +
  "- clarification.toggles: independent hidden add-ons NOT visible (max 4). " +
  "Use ids added_sugar, condensed_milk, cream with short labels (Sugar, Condensed milk, Cream).\n" +
  "- clarification.exclusive: one-of choice when needed (e.g. fried/glossy food oil level). " +
  "id cooking_oil, prompt like 'How oily does it look?', options light/medium/heavy.\n" +
  "- Use toggles for drinks missing visible sweetener; use exclusive for ambiguous oil or milk type.\n" +
  "- If nothing hidden, return toggles: [] and exclusive: null.\n\n" +
  "Example layered iced latte (no condensed milk unless visible):\n" +
  "description 'iced latte', portion {container_type:'cup', container_volume_ml:400, fill_fraction:0.75, " +
  "notes:'medium plastic cup'}, items [{name:'whole milk', weight_g:195, volume_ml:195, volume_fraction:0.65, ...}, " +
  "{name:'coffee', weight_g:75, volume_ml:75, volume_fraction:0.25, ...}], " +
  "clarification {toggles:[{id:'added_sugar',label:'Sugar'}], exclusive:null}.\n" +
  "Never use compound item names like 'espresso with sweetener'.";

const EMPTY_CLARIFICATION: ClarificationSpec = { toggles: [], exclusive: null };

export async function estimateFromImage(
  env: Env,
  imageBytes: Uint8Array,
  mime: string,
  caption?: string | null,
): Promise<VisionResult> {
  const settings = getSettings(env);
  if (!settings.aiEnabled) {
    return {
      estimate: normalizeMacroEstimate({
        description: caption || "food photo",
        confidence: 0,
        assumptions: ["AI vision disabled"],
        items: [],
        portion: {
          container_type: "unknown",
          container_volume_ml: null,
          fill_fraction: 1,
          notes: null,
        },
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        food_confidence: 0,
        portion_confidence: 0,
      }),
      clarification: EMPTY_CLARIFICATION,
    };
  }

  const visionModel = createVisionModel(env).withStructuredOutput(strictVisionOutputSchema, {
    name: "meal_estimate",
    method: "functionCalling",
    strict: true,
  });

  let prompt = VISION_PROMPT;
  if (caption) prompt += `\n\nUser note: ${caption}`;

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
    strictVisionOutputSchema.parse(result);
    if (hasNamedItemsButZeroMacros(result)) {
      const retryPrompt =
        "Re-estimate nutrition. Preserve portion block and weight_g / volume_ml / volume_fraction " +
        "for each item. All calorie and macro fields must be best-effort numeric estimates, not placeholders. " +
        "Keep the same JSON shape including clarification.";
      result = await invokeEstimate(retryPrompt);
      strictVisionOutputSchema.parse(result);
    }

    const parsed = strictVisionOutputSchema.parse(result);
    const clarification = clarificationSpecSchema.parse(
      parsed.clarification ?? EMPTY_CLARIFICATION,
    );
    const estimate = normalizeMacroEstimate(
      macroEstimateSchema.parse(stripClarificationFromEstimate(parsed)),
    );

    const logger = createLogger(settings.logLevel);
    logger.debug({
      stage: "vision",
      description: estimate.description,
      portion: estimate.portion,
      calories: estimate.calories,
      clarification,
      items: (estimate.items ?? []).map((i) => ({
        name: i.name,
        weight_g: i.weight_g,
        volume_ml: i.volume_ml,
        calories: i.calories,
      })),
    });

    return { estimate, clarification };
  } catch (err) {
    console.error("Vision estimate failed", err);
    return {
      estimate: normalizeMacroEstimate({
        description: caption || "food photo",
        confidence: 0.2,
        assumptions: ["vision structured output failed"],
        items: [],
        portion: {
          container_type: "unknown",
          container_volume_ml: null,
          fill_fraction: 1,
          notes: null,
        },
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        food_confidence: 0,
        portion_confidence: 0,
      }),
      clarification: EMPTY_CLARIFICATION,
    };
  }
}
