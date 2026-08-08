import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { Env } from "../env";
import { getSettings } from "../config";
import { createVisionModel } from "../agents/llm";
import type { FatSecretFood } from "./fatsecret";
import { preferredFoodImageUrl } from "./fatsecret";
import { createLogger } from "./logger";

const rankResultSchema = z.object({
  best_food_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type FoodImageRanker = (
  itemName: string,
  candidates: FatSecretFood[],
) => Promise<FatSecretFood | null>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

const MIN_MATCH_CONFIDENCE = 0.55;
const MAX_CANDIDATES = 3;

/**
 * Vision ranker: compare the user meal photo against FatSecret reference images
 * for a single visible item and return the best matching food (or null).
 */
export function createFoodImageRanker(
  env: Env,
  userPhoto: { bytes: Uint8Array; mime: string },
): FoodImageRanker {
  const settings = getSettings(env);
  const logger = createLogger(settings.logLevel);

  return async (itemName, candidates) => {
    if (!settings.aiEnabled) return null;

    const ranked = candidates
      .map((food) => ({
        food,
        imageUrl: preferredFoodImageUrl(food),
      }))
      .filter((entry): entry is { food: FatSecretFood; imageUrl: string } =>
        Boolean(entry.imageUrl),
      )
      .slice(0, MAX_CANDIDATES);

    if (ranked.length === 0) return null;

    try {
      const model = createVisionModel(env).withStructuredOutput(rankResultSchema, {
        name: "fatsecret_image_rank",
        method: "functionCalling",
        strict: true,
      });

      const userDataUrl = `data:${userPhoto.mime};base64,${bytesToBase64(userPhoto.bytes)}`;
      const candidateLines = ranked
        .map((entry, idx) => {
          const subs = entry.food.subCategories.length
            ? ` subcategories=[${entry.food.subCategories.slice(0, 4).join(", ")}]`
            : "";
          return `${idx + 1}. food_id=${entry.food.food_id} name="${entry.food.food_name}"${subs}`;
        })
        .join("\n");

      const content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      > = [
        {
          type: "text",
          text:
            `The first image is the user's meal photo. Identify the component "${itemName}" in that photo. ` +
            `Then compare it to the FatSecret reference images that follow and pick the best match.\n` +
            `Use food names AND subcategories as hints (e.g. prefer "Apples"/"Fruit" over "Juice" for an apple).\n` +
            `Candidates:\n${candidateLines}\n` +
            `Return best_food_id from the list, or null if none is a reasonable visual match. ` +
            `confidence is 0–1 for how sure you are the reference shows the same food as that component.`,
        },
        { type: "image_url", image_url: { url: userDataUrl } },
      ];

      for (const entry of ranked) {
        const subs = entry.food.subCategories.length
          ? ` subcategories=[${entry.food.subCategories.slice(0, 4).join(", ")}]`
          : "";
        content.push({
          type: "text",
          text: `Reference for food_id=${entry.food.food_id} (${entry.food.food_name}${subs}):`,
        });
        content.push({
          type: "image_url",
          image_url: { url: entry.imageUrl },
        });
      }

      const result = rankResultSchema.parse(
        await model.invoke([new HumanMessage({ content })]),
      );

      logger.debug({
        stage: "fatsecret_image_rank",
        item: itemName,
        best_food_id: result.best_food_id,
        confidence: result.confidence,
        reason: result.reason,
      });

      if (!result.best_food_id || result.confidence < MIN_MATCH_CONFIDENCE) {
        return null;
      }

      return (
        ranked.find((entry) => entry.food.food_id === result.best_food_id)?.food ??
        null
      );
    } catch (err) {
      logger.warn({
        stage: "fatsecret_image_rank",
        item: itemName,
        message: "image ranking failed; falling back to top search hit",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
}
