/**
 * @vitest-environment node
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../src/env";
import type { FatSecretFood } from "../src/services/fatsecret";

const invoke = vi.fn();

vi.mock("../src/agents/llm", () => ({
  createVisionModel: () => ({
    withStructuredOutput: () => ({ invoke }),
  }),
}));

import { createFoodImageRanker } from "../src/services/food-image-rank";

const testEnv = {
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_VISION_MODEL: "openai/gpt-4o",
} as Env;

const candidates: FatSecretFood[] = [
  {
    food_id: "1",
    food_name: "Apple Juice",
    servings: [],
    images: [
      { image_url: "https://www.foodimagedb.com/food-images/a_400x400.png" },
    ],
    subCategories: ["Juice"],
  },
  {
    food_id: "2",
    food_name: "Apple",
    servings: [],
    images: [
      { image_url: "https://www.foodimagedb.com/food-images/b_400x400.png" },
    ],
    subCategories: ["Apples", "Fruit"],
  },
];

describe("createFoodImageRanker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the ranked food when confidence is high enough", async () => {
    invoke.mockResolvedValue({
      best_food_id: "2",
      confidence: 0.9,
      reason: "looks like a whole apple",
    });

    const ranker = createFoodImageRanker(testEnv, {
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
    });
    const selected = await ranker("apple", candidates);
    expect(selected?.food_id).toBe("2");
    expect(invoke).toHaveBeenCalled();
  });

  it("returns null when confidence is below threshold", async () => {
    invoke.mockResolvedValue({
      best_food_id: "2",
      confidence: 0.2,
      reason: "uncertain",
    });

    const ranker = createFoodImageRanker(testEnv, {
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
    });
    await expect(ranker("apple", candidates)).resolves.toBeNull();
  });

  it("returns null when candidates have no images", async () => {
    const ranker = createFoodImageRanker(testEnv, {
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/jpeg",
    });
    await expect(
      ranker("apple", [{ ...candidates[0]!, images: [] }]),
    ).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});
