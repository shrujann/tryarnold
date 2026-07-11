import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";
import type { MacroEstimate } from "../src/schemas/nutrition";
import {
  buildSignatureBaseString,
  blendItemMacrosWithVision,
  enrichEstimateWithFatSecret,
  FATSECRET_API_URL,
  parseSearchResponse,
  percentEncode,
  pickServing,
  signOAuth1,
  type FatSecretServing,
} from "../src/services/fatsecret";

const baseEnv = {
  PUBLIC_BASE_URL: "https://example.com",
  LOG_LEVEL: "DEBUG",
} as Env;

function settingsWithFatSecret() {
  return getSettings({
    ...baseEnv,
    FATSECRET_CONSUMER_KEY: "test-key",
    FATSECRET_CONSUMER_SECRET: "test-secret",
  } as Env);
}

describe("OAuth 1.0 signing", () => {
  it("percent-encodes reserved characters per RFC 3986", () => {
    expect(percentEncode("hello world")).toBe("hello%20world");
    expect(percentEncode("a+b")).toBe("a%2Bb");
  });

  it("builds a deterministic signature base string", () => {
    const params = {
      format: "json",
      method: "foods.search.v5",
      oauth_consumer_key: "abc",
      oauth_nonce: "fixed-nonce",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1234567890",
      oauth_version: "1.0",
      search_expression: "apple",
    };
    const base = buildSignatureBaseString("POST", FATSECRET_API_URL, params);
    expect(base).toContain("POST&");
    expect(base).toContain(percentEncode(FATSECRET_API_URL));
    expect(base).toContain("apple");
  });

  it("produces a stable HMAC-SHA1 signature for fixed inputs", async () => {
    const baseString =
      "POST&https%3A%2F%2Fplatform.fatsecret.com%2Frest%2Fserver.api&format%3Djson%26method%3Dfoods.search.v5";
    const sig1 = await signOAuth1(baseString, "consumer-secret");
    const sig2 = await signOAuth1(baseString, "consumer-secret");
    expect(sig1).toBe(sig2);
    expect(sig1.length).toBeGreaterThan(10);
  });
});

describe("parseSearchResponse", () => {
  it("parses a single food and single serving", () => {
    const body = {
      foods_search: {
        total_results: "1",
        results: {
          food: {
            food_id: "1",
            food_name: "Apple",
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "1 medium",
                calories: "95",
                carbohydrate: "25",
                protein: "0.5",
                fat: "0.3",
              },
            },
          },
        },
      },
    };
    const parsed = parseSearchResponse(body);
    expect(parsed.total_results).toBe(1);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.foods[0]!.food_name).toBe("Apple");
    expect(parsed.foods[0]!.servings).toHaveLength(1);
  });

  it("parses v1 foods.search response (Basic tier shape)", () => {
    const body = {
      foods: {
        total_results: "1799",
        max_results: "3",
        page_number: "0",
        food: [
          {
            food_id: "794",
            food_name: "Whole Milk",
            food_type: "Generic",
            food_description: "Per 100g - Calories: 60kcal | Fat: 3.25g | Carbs: 4.52g | Protein: 3.22g",
          },
        ],
      },
    };
    const parsed = parseSearchResponse(body);
    expect(parsed.total_results).toBe(1799);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.foods[0]!.food_name).toBe("Whole Milk");
    expect(parsed.foods[0]!.servings).toHaveLength(0);
  });

  it("parses food and serving arrays (v5 shape)", () => {
    const body = {
      foods_search: {
        total_results: "2",
        results: {
          food: [
            {
              food_id: "1",
              food_name: "Apple",
              servings: {
                serving: [
                  {
                    serving_id: "10",
                    serving_description: "100 g",
                    metric_serving_amount: "100.000",
                    metric_serving_unit: "g",
                    calories: "52",
                    carbohydrate: "14",
                    protein: "0.3",
                    fat: "0.2",
                  },
                  {
                    serving_id: "11",
                    serving_description: "1 medium",
                    calories: "95",
                    carbohydrate: "25",
                    protein: "0.5",
                    fat: "0.3",
                  },
                ],
              },
            },
            {
              food_id: "2",
              food_name: "Banana",
              servings: {
                serving: {
                  serving_id: "20",
                  serving_description: "1 medium",
                  calories: "105",
                  carbohydrate: "27",
                  protein: "1.3",
                  fat: "0.4",
                },
              },
            },
          ],
        },
      },
    };
    const parsed = parseSearchResponse(body);
    expect(parsed.foods).toHaveLength(2);
    expect(parsed.foods[0]!.servings).toHaveLength(2);
  });
});

describe("blendItemMacrosWithVision", () => {
  it("scales FatSecret 100g macros to vision portion calories", () => {
    const item = {
      name: "whole milk",
      calories: 120,
      protein_g: 6,
      carbs_g: 10,
      fat_g: 6,
    };
    const blended = blendItemMacrosWithVision(item, {
      calories: 60,
      protein_g: 3.22,
      carbs_g: 4.52,
      fat_g: 3.25,
    });
    expect(blended.calories).toBe(120);
    expect(blended.protein_g).toBe(6.4);
  });

  it("keeps vision macros when FatSecret serving is zero-calorie", () => {
    const item = {
      name: "sweetener",
      calories: 125,
      protein_g: 0,
      carbs_g: 30,
      fat_g: 0,
    };
    const blended = blendItemMacrosWithVision(item, {
      calories: 0,
      protein_g: 0,
      carbs_g: 1,
      fat_g: 0,
    });
    expect(blended.calories).toBe(125);
    expect(blended.carbs_g).toBe(30);
  });
});

describe("pickServing", () => {
  it("prefers a 100 g serving when available", () => {
    const servings: FatSecretServing[] = [
      {
        serving_id: "1",
        serving_description: "1 cup",
        calories: "100",
        carbohydrate: "20",
        protein: "2",
        fat: "1",
      },
      {
        serving_id: "2",
        serving_description: "100 g",
        metric_serving_amount: "100.000",
        metric_serving_unit: "g",
        calories: "52",
        carbohydrate: "14",
        protein: "0.3",
        fat: "0.2",
      },
    ];
    const picked = pickServing(servings);
    expect(picked?.serving_id).toBe("2");
  });

  it("falls back to the first serving", () => {
    const servings: FatSecretServing[] = [
      {
        serving_id: "1",
        serving_description: "1 slice",
        calories: "80",
        carbohydrate: "10",
        protein: "3",
        fat: "2",
      },
    ];
    expect(pickServing(servings)?.serving_id).toBe("1");
  });
});

describe("enrichEstimateWithFatSecret", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const visionEstimate: MacroEstimate = {
    description: "apple snack",
    confidence: 0.5,
    food_confidence: 0.5,
    portion_confidence: 0.7,
    assumptions: ["vision guess"],
    items: [
      {
        name: "apple",
        quantity: "1 medium",
        plate_share: 1,
        calories: 50,
        protein_g: 0.2,
        carbs_g: 12,
        fat_g: 0.1,
      },
    ],
    calories: 50,
    protein_g: 0.2,
    carbs_g: 12,
    fat_g: 0.1,
  };

  it("returns unchanged estimate when FatSecret is disabled", async () => {
    const settings = getSettings(baseEnv);
    const result = await enrichEstimateWithFatSecret(visionEstimate, settings);
    expect(result.fatsecretUsed).toBe(false);
    expect(result.estimate.calories).toBe(50);
  });

  it("replaces macros from FatSecret and sets fatsecretUsed", async () => {
    const settings = settingsWithFatSecret();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: {
                food_id: "1",
                food_name: "Apple",
                food_type: "Generic",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            food: {
              food_id: "1",
              food_name: "Apple",
              servings: {
                serving: {
                  serving_id: "10",
                  serving_description: "100 g",
                  metric_serving_amount: "100.000",
                  metric_serving_unit: "g",
                  calories: "52",
                  carbohydrate: "14",
                  protein: "0.3",
                  fat: "0.2",
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await enrichEstimateWithFatSecret(visionEstimate, settings);
    expect(result.fatsecretUsed).toBe(true);
    expect(result.estimate.items[0]!.calories).toBe(50);
    expect(result.estimate.items[0]!.carbs_g).toBe(13.5);
    expect(result.estimate.calories).toBe(50);
    expect(result.estimate.food_confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.estimate.assumptions.some((a) => a.startsWith("fatsecret:"))).toBe(true);
  });

  it("keeps vision macros when search returns no results", async () => {
    const settings = settingsWithFatSecret();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          foods: {
            total_results: "0",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await enrichEstimateWithFatSecret(visionEstimate, settings);
    expect(result.fatsecretUsed).toBe(false);
    expect(result.estimate.calories).toBe(50);
  });

  it("keeps vision macros when API fails", async () => {
    const settings = settingsWithFatSecret();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const result = await enrichEstimateWithFatSecret(visionEstimate, settings);
    expect(result.fatsecretUsed).toBe(false);
    expect(result.estimate.calories).toBe(50);
  });

  it("applies plate_share multiplier to FatSecret serving macros", async () => {
    const settings = settingsWithFatSecret();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: "1", food_name: "Apple", food_type: "Generic" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            food: {
              food_id: "1",
              food_name: "Apple",
              servings: {
                serving: {
                  serving_id: "10",
                  serving_description: "100 g",
                  metric_serving_amount: "100.000",
                  metric_serving_unit: "g",
                  calories: "100",
                  carbohydrate: "20",
                  protein: "2",
                  fat: "1",
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const halfPlate: MacroEstimate = {
      ...visionEstimate,
      items: [{ ...visionEstimate.items[0]!, plate_share: 0.5 }],
    };

    const result = await enrichEstimateWithFatSecret(halfPlate, settings);
    expect(result.fatsecretUsed).toBe(true);
    expect(result.estimate.items[0]!.calories).toBe(50);
  });
});
