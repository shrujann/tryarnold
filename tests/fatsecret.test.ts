import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";
import type { MacroEstimate } from "../src/schemas/nutrition";
import {
  buildSignatureBaseString,
  blendItemMacrosWithVision,
  assembleMealFromPrefetchCache,
  fetchClarifyNutritionCache,
  enrichEstimateWithFatSecret,
  preferredFoodImageUrl,
  reconcileItemMacrosToMeal,
  selectFoodMatch,
  WEIGHT_UNCERTAIN_ASSUMPTION,
  FATSECRET_API_URL,
  parseSearchResponse,
  percentEncode,
  pickServing,
  signOAuth1,
  type FatSecretFood,
  type FatSecretServing,
} from "../src/services/fatsecret";
import { expandCompoundItems } from "../src/services/item-split";

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

  it("parses include_food_images payloads", () => {
    const body = {
      foods_search: {
        total_results: "1",
        results: {
          food: {
            food_id: "1641",
            food_name: "Chicken Breast",
            food_images: {
              food_image: [
                {
                  image_url:
                    "https://www.foodimagedb.com/food-images/x_1024x1024.png",
                  image_type: "1",
                },
                {
                  image_url:
                    "https://www.foodimagedb.com/food-images/x_400x400.png",
                  image_type: "1",
                },
              ],
            },
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "100 g",
                calories: "165",
                carbohydrate: "0",
                protein: "31",
                fat: "3.6",
              },
            },
          },
        },
      },
    };
    const parsed = parseSearchResponse(body);
    expect(parsed.foods[0]!.images).toHaveLength(2);
    expect(preferredFoodImageUrl(parsed.foods[0]!)).toContain("400x400");
  });
});

describe("selectFoodMatch", () => {
  const foods: FatSecretFood[] = [
    {
      food_id: "1",
      food_name: "Apple Juice",
      servings: [],
      images: [
        {
          image_url: "https://www.foodimagedb.com/food-images/a_400x400.png",
        },
      ],
    },
    {
      food_id: "2",
      food_name: "Apple",
      servings: [],
      images: [
        {
          image_url: "https://www.foodimagedb.com/food-images/b_400x400.png",
        },
      ],
    },
  ];

  it("returns the top hit when no ranker is provided", async () => {
    const selected = await selectFoodMatch(foods, "apple");
    expect(selected?.food_id).toBe("1");
  });

  it("uses image ranker when available", async () => {
    const selected = await selectFoodMatch(foods, "apple", {
      rankFoodCandidates: async () => foods[1]!,
    });
    expect(selected?.food_id).toBe("2");
  });

  it("falls back to top hit when ranker returns null", async () => {
    const selected = await selectFoodMatch(foods, "apple", {
      rankFoodCandidates: async () => null,
    });
    expect(selected?.food_id).toBe("1");
  });
});

describe("blendItemMacrosWithVision", () => {
  it("uses FatSecret serving as-is when vision portion amount is missing", () => {
    const item = {
      name: "whole milk",
      weight_g: 0,
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
    expect(blended.calories).toBe(60);
    expect(blended.protein_g).toBe(3.22);
  });

  it("scales by weight_g ratio when serving metric is available", () => {
    const item = {
      name: "whole milk",
      weight_g: 255,
      calories: 160,
      protein_g: 8,
      carbs_g: 12,
      fat_g: 8,
    };
    const serving: FatSecretServing = {
      serving_id: "1",
      serving_description: "100 g",
      metric_serving_amount: "100.000",
      metric_serving_unit: "g",
      calories: "60",
      carbohydrate: "4.52",
      protein: "3.22",
      fat: "3.25",
    };
    const blended = blendItemMacrosWithVision(
      item,
      {
        calories: 60,
        protein_g: 3.22,
        carbs_g: 4.52,
        fat_g: 3.25,
      },
      serving,
    );
    expect(blended.calories).toBe(153);
    expect(blended.protein_g).toBe(8.2);
  });

  it("returns zero macros for zero-weight items (e.g. ice)", () => {
    const item = {
      name: "ice",
      weight_g: 0,
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
    expect(blended.calories).toBe(0);
    expect(blended.carbs_g).toBe(0);
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

  it("prefers serving closest to vision weight_g", () => {
    const servings: FatSecretServing[] = [
      {
        serving_id: "1",
        serving_description: "1 cup",
        metric_serving_amount: "244.000",
        metric_serving_unit: "ml",
        calories: "146",
        carbohydrate: "11.7",
        protein: "7.9",
        fat: "7.9",
      },
      {
        serving_id: "2",
        serving_description: "100 g",
        metric_serving_amount: "100.000",
        metric_serving_unit: "g",
        calories: "60",
        carbohydrate: "4.52",
        protein: "3.22",
        fat: "3.25",
      },
    ];
    const item = {
      name: "whole milk",
      weight_g: 255,
      volume_ml: 255,
      calories: 160,
      protein_g: 8,
      carbs_g: 12,
      fat_g: 8,
    };
    const picked = pickServing(servings, item);
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


describe("searchFoods premier images", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls foods.search.v5 with include_food_images", async () => {
    const settings = settingsWithFatSecret();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          foods_search: {
            total_results: "1",
            results: {
              food: {
                food_id: "1",
                food_name: "Apple",
                food_images: {
                  food_image: {
                    image_url: "https://www.foodimagedb.com/food-images/a_400x400.png",
                  },
                },
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
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { searchFoods } = await import("../src/services/fatsecret");
    const result = await searchFoods("apple", settings);
    expect(result.foods[0]!.images[0]!.image_url).toContain("400x400");

    const body = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as string);
    expect(body.get("method")).toBe("foods.search.v5");
    expect(body.get("include_food_images")).toBe("true");
  });

  it("falls back to foods.search when v5 is unknown", async () => {
    const settings = settingsWithFatSecret();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "107", message: "Unknown method: foods.search.v5" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: "1", food_name: "Apple" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const { searchFoods } = await import("../src/services/fatsecret");
    const result = await searchFoods("apple", settings);
    expect(result.foods[0]!.food_name).toBe("Apple");
    const first = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as string);
    const second = new URLSearchParams(fetchMock.mock.calls[1]![1]?.body as string);
    expect(first.get("method")).toBe("foods.search.v5");
    expect(second.get("method")).toBe("foods.search");
    expect(second.get("include_food_images")).toBeNull();
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

  it("uses image ranker to pick among search candidates", async () => {
    const settings = settingsWithFatSecret();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          foods_search: {
            total_results: "2",
            results: {
              food: [
                {
                  food_id: "1",
                  food_name: "Apple Juice",
                  food_images: {
                    food_image: {
                      image_url: "https://www.foodimagedb.com/food-images/a_400x400.png",
                    },
                  },
                  servings: {
                    serving: {
                      serving_id: "10",
                      serving_description: "100 g",
                      metric_serving_amount: "100.000",
                      metric_serving_unit: "g",
                      calories: "46",
                      carbohydrate: "11",
                      protein: "0.1",
                      fat: "0.1",
                    },
                  },
                },
                {
                  food_id: "2",
                  food_name: "Apple",
                  food_images: {
                    food_image: {
                      image_url: "https://www.foodimagedb.com/food-images/b_400x400.png",
                    },
                  },
                  servings: {
                    serving: {
                      serving_id: "20",
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
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await enrichEstimateWithFatSecret(visionEstimate, settings, {
      rankFoodCandidates: async (_name, candidates) =>
        candidates.find((c) => c.food_id === "2") ?? null,
    });

    expect(result.fatsecretUsed).toBe(true);
    expect(result.estimate.items[0]!.calories).toBe(52);
    expect(result.estimate.assumptions.some((a) => a.includes("Apple"))).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

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
    expect(result.estimate.items[0]!.calories).toBe(52);
    expect(result.estimate.items[0]!.carbs_g).toBe(14);
    expect(result.estimate.calories).toBe(52);
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

  it("expands compound items before FatSecret search", async () => {
    const settings = settingsWithFatSecret();
    const compoundEstimate: MacroEstimate = {
      description: "iced coffee",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "espresso with sweetener",
          calories: 200,
          protein_g: 5,
          carbs_g: 20,
          fat_g: 8,
        },
      ],
      calories: 200,
      protein_g: 5,
      carbs_g: 20,
      fat_g: 8,
    };

    const expanded = expandCompoundItems(compoundEstimate.items);
    expect(expanded.items).toHaveLength(2);

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (_input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const searchExpression = body.get("search_expression") ?? "";
      const method = body.get("method");

      if (method === "foods.search.v5" || method === "foods.search") {
        return new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: {
                food_id: searchExpression === "coffee" ? "1" : "2",
                food_name: searchExpression,
                food_type: "Generic",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          food: {
            food_id: searchExpression === "coffee" ? "1" : "2",
            food_name: searchExpression,
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "100 g",
                metric_serving_amount: "100.000",
                metric_serving_unit: "g",
                calories: "100",
                carbohydrate: "10",
                protein: "2",
                fat: "1",
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await enrichEstimateWithFatSecret(compoundEstimate, settings);
    expect(result.fatsecretUsed).toBe(true);
    expect(result.estimate.items).toHaveLength(2);
    expect(result.estimate.assumptions.some((note) => note.startsWith("split:"))).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("assembles visible + selected add-ons from prefetch cache only", () => {
    const draft: MacroEstimate = {
      description: "iced latte",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "whole milk",
          weight_g: 195,
          volume_ml: 195,
          calories: 115,
          protein_g: 6,
          carbs_g: 9,
          fat_g: 5,
        },
        {
          name: "brewed coffee",
          weight_g: 75,
          volume_ml: 75,
          calories: 1,
          protein_g: 0,
          carbs_g: 0,
          fat_g: 0,
        },
      ],
      calories: 116,
      protein_g: 6,
      carbs_g: 9,
      fat_g: 5,
    };

    const cache = {
      visibleItems: [
        { name: "whole milk", weight_g: 195, calories: 120, protein_g: 6, carbs_g: 9, fat_g: 5 },
        { name: "brewed coffee", weight_g: 75, calories: 2, protein_g: 0, carbs_g: 0, fat_g: 0 },
      ],
      addOns: {
        added_sugar: {
          name: "sugar",
          weight_g: 5,
          calories: 20,
          protein_g: 0,
          carbs_g: 5,
          fat_g: 0,
        },
      },
      assumptions: [
        "fatsecret: Whole Milk (100 g)",
        "fatsecret: Sugar (1 tsp)",
      ],
      fatsecretUsed: true,
    };

    const withSugar = assembleMealFromPrefetchCache(draft, ["added_sugar"], null, cache);
    expect(withSugar.estimate.items).toHaveLength(3);
    expect(withSugar.estimate.items.some((i) => i.name === "sugar")).toBe(true);
    expect(withSugar.estimate.calories).toBeGreaterThan(116);
    expect(withSugar.fatsecretUsed).toBe(true);

    const withoutSugar = assembleMealFromPrefetchCache(draft, [], null, cache);
    expect(withoutSugar.estimate.items).toHaveLength(2);
    expect(withoutSugar.estimate.items.some((i) => i.name === "sugar")).toBe(false);
    expect(withoutSugar.estimate.calories).toBe(122);
    expect(
      withoutSugar.estimate.assumptions.some((a) => a.toLowerCase().includes("sugar")),
    ).toBe(false);
  });

  it("does not include unselected prefetch add-ons in totals", () => {
    const draft: MacroEstimate = {
      description: "coffee",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [{ name: "coffee", calories: 5, protein_g: 0, carbs_g: 1, fat_g: 0 }],
      calories: 5,
      protein_g: 0,
      carbs_g: 1,
      fat_g: 0,
    };
    const cache = {
      visibleItems: [{ name: "coffee", calories: 5, protein_g: 0, carbs_g: 1, fat_g: 0 }],
      addOns: {
        added_sugar: { name: "sugar", calories: 20, protein_g: 0, carbs_g: 5, fat_g: 0 },
        cream: { name: "cream", calories: 50, protein_g: 0.5, carbs_g: 1, fat_g: 5 },
      },
      assumptions: ["fatsecret: Sugar (1 tsp)", "fatsecret: Cream (1 tbsp)"],
      fatsecretUsed: true,
    };

    const noneSelected = assembleMealFromPrefetchCache(draft, [], null, cache);
    expect(noneSelected.estimate.calories).toBe(5);

    const sugarOnly = assembleMealFromPrefetchCache(draft, ["added_sugar"], null, cache);
    expect(sugarOnly.estimate.calories).toBe(25);
  });

  it("sums FatSecret macros scaled by vision portion weights", async () => {
    const settings = settingsWithFatSecret();
    const icedCoffee: MacroEstimate = {
      description: "iced coffee",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "coffee",
          weight_g: 100,
          calories: 120,
          protein_g: 3,
          carbs_g: 8,
          fat_g: 4,
        },
        {
          name: "whole milk",
          weight_g: 150,
          calories: 130,
          protein_g: 4,
          carbs_g: 10,
          fat_g: 6,
        },
      ],
      calories: 250,
      protein_g: 7,
      carbs_g: 18,
      fat_g: 12,
    };

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (_input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const method = body.get("method");
      const searchExpression = body.get("search_expression") ?? "";
      const foodId = body.get("food_id") ?? "";

      if (method === "foods.search.v5" || method === "foods.search") {
        return new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: searchExpression, food_name: "Food", food_type: "Generic" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const key = foodId || searchExpression;
      const macros =
        key.includes("milk")
          ? { calories: "60", carbohydrate: "4.52", protein: "3.22", fat: "3.25" }
          : { calories: "2", carbohydrate: "0.38", protein: "0.11", fat: "0.01" };

      return new Response(
        JSON.stringify({
          food: {
            food_id: key,
            food_name: key,
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "100 g",
                metric_serving_amount: "100.000",
                metric_serving_unit: "g",
                ...macros,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await enrichEstimateWithFatSecret(icedCoffee, settings);
    expect(result.fatsecretUsed).toBe(true);
    // milk 150g @ 60/100g + coffee 100g @ 2/100g
    expect(result.estimate.calories).toBe(92);
    expect(result.estimate.items.find((i) => i.name.includes("milk"))!.calories).toBe(90);
    expect(result.estimate.items.find((i) => i.name.includes("coffee"))!.calories).toBe(2);
  });

  it("scales drink items by vision weight with realistic FatSecret densities", async () => {
    const settings = settingsWithFatSecret();
    const icedCoffee: MacroEstimate = {
      description: "iced coffee with milk",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "whole milk",
          weight_g: 192,
          calories: 128,
          protein_g: 5,
          carbs_g: 8,
          fat_g: 5,
        },
        {
          name: "iced coffee",
          weight_g: 96,
          calories: 144,
          protein_g: 3,
          carbs_g: 12,
          fat_g: 5,
        },
        {
          name: "sugar",
          weight_g: 5,
          calories: 20,
          protein_g: 0,
          carbs_g: 5,
          fat_g: 0,
        },
      ],
      calories: 292,
      protein_g: 8,
      carbs_g: 25,
      fat_g: 10,
    };

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockImplementation(async (_input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const method = body.get("method");
      const searchExpression = body.get("search_expression") ?? "";
      const foodId = body.get("food_id") ?? "";

      if (method === "foods.search.v5" || method === "foods.search") {
        const foodName =
          searchExpression.includes("milk")
            ? "Whole Milk"
            : searchExpression.includes("sugar")
              ? "Sugar"
              : "Iced Coffee";
        return new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: searchExpression, food_name: foodName, food_type: "Generic" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const key = foodId || searchExpression;
      const macros =
        key.includes("milk")
          ? { calories: "60", carbohydrate: "4.52", protein: "3.22", fat: "3.25" }
          : key.includes("sugar")
            ? { calories: "387", carbohydrate: "99.98", protein: "0", fat: "0" }
            : { calories: "2", carbohydrate: "0.38", protein: "0.11", fat: "0.01" };

      return new Response(
        JSON.stringify({
          food: {
            food_id: key,
            food_name: key,
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "100 g",
                metric_serving_amount: "100.000",
                metric_serving_unit: "g",
                ...macros,
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await enrichEstimateWithFatSecret(icedCoffee, settings);
    expect(result.fatsecretUsed).toBe(true);
    // 192g milk @ 60/100 + 96g coffee @ 2/100 + 5g sugar @ 387/100 ≈ 136.5
    expect(result.estimate.calories).toBe(136.5);
    expect(result.estimate.items.find((i) => i.name.includes("milk"))!.calories).toBe(115.2);
    expect(result.estimate.items.find((i) => i.name.includes("coffee"))!.calories).toBe(1.9);
  });

  it("uses standard serving and weight note when weight_g is missing", async () => {
    const settings = settingsWithFatSecret();
    const estimate: MacroEstimate = {
      description: "salad",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "apple",
          weight_g: 0,
          calories: 95,
          protein_g: 0.5,
          carbs_g: 25,
          fat_g: 0.3,
        },
      ],
      calories: 95,
      protein_g: 0.5,
      carbs_g: 25,
      fat_g: 0.3,
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const method = body.get("method");
      if (method === "foods.search.v5" || method === "foods.search") {
        return new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: "1", food_name: "Apple", food_type: "Generic" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
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
      );
    });

    const result = await enrichEstimateWithFatSecret(estimate, settings);
    expect(result.estimate.items[0]!.calories).toBe(52);
    expect(result.estimate.assumptions).toContain(WEIGHT_UNCERTAIN_ASSUMPTION);
  });

  it("records vision fallback notes for items without fatsecret match", async () => {
    const settings = settingsWithFatSecret();
    const estimate: MacroEstimate = {
      description: "mixed plate",
      confidence: 0.5,
      food_confidence: 0.5,
      portion_confidence: 0.7,
      assumptions: [],
      items: [
        {
          name: "whole milk",
          weight_g: 150,
          calories: 90,
          protein_g: 5,
          carbs_g: 7,
          fat_g: 4,
        },
        {
          name: "mystery house sauce",
          weight_g: 30,
          calories: 120,
          protein_g: 1,
          carbs_g: 10,
          fat_g: 8,
        },
      ],
      calories: 210,
      protein_g: 6,
      carbs_g: 17,
      fat_g: 12,
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = new URLSearchParams(init?.body as string);
      const method = body.get("method");
      const searchExpression = body.get("search_expression") ?? "";
      const foodId = body.get("food_id") ?? "";

      if (method === "foods.search.v5" || method === "foods.search") {
        if (searchExpression.includes("mystery")) {
          return new Response(
            JSON.stringify({ foods: { total_results: "0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            foods: {
              total_results: "1",
              food: { food_id: "milk", food_name: "Whole Milk", food_type: "Generic" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      const key = foodId || searchExpression;
      return new Response(
        JSON.stringify({
          food: {
            food_id: key,
            food_name: "Whole Milk",
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "100 g",
                metric_serving_amount: "100.000",
                metric_serving_unit: "g",
                calories: "60",
                carbohydrate: "4.52",
                protein: "3.22",
                fat: "3.25",
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const result = await enrichEstimateWithFatSecret(estimate, settings);
    expect(result.estimate.items[0]!.calories).toBe(90);
    expect(result.estimate.items[1]!.calories).toBe(120);
    expect(
      result.estimate.assumptions.some((a) =>
        a.includes("nutrition: vision estimate"),
      ),
    ).toBe(true);
  });
});

describe("reconcileItemMacrosToMeal", () => {
  it("scales item macros while preserving per-item calories", () => {
    const items = [
      { name: "coffee", calories: 120, protein_g: 1, carbs_g: 8, fat_g: 4 },
      { name: "milk", calories: 130, protein_g: 1, carbs_g: 8, fat_g: 4 },
    ];
    const reconciled = reconcileItemMacrosToMeal(items, {
      protein_g: 7,
      carbs_g: 18,
      fat_g: 12,
    });

    const proteinSum = reconciled.reduce((sum, item) => sum + item.protein_g, 0);
    const carbsSum = reconciled.reduce((sum, item) => sum + item.carbs_g, 0);
    const fatSum = reconciled.reduce((sum, item) => sum + item.fat_g, 0);
    expect(reconciled[0]!.calories).toBe(120);
    expect(reconciled[1]!.calories).toBe(130);
    expect(proteinSum).toBe(7);
    expect(carbsSum).toBe(18);
    expect(fatSum).toBe(12);
  });
});
