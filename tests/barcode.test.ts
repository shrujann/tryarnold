import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractBarcodeCandidate,
  extractBarcodeFromText,
  isBarcodeCommand,
  normalizeGtin13,
} from "../src/services/barcode";
import {
  estimateFromBarcodeFood,
  findFoodByBarcode,
  parseFoodGetResponse,
  pickDefaultServing,
} from "../src/services/fatsecret";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";

describe("normalizeGtin13", () => {
  it("keeps 13-digit EAN/JAN codes", () => {
    expect(normalizeGtin13("8881234567890")).toBe("8881234567890");
  });

  it("pads UPC-A and EAN-8 to GTIN-13", () => {
    expect(normalizeGtin13("123456789012")).toBe("0123456789012");
    expect(normalizeGtin13("12345678")).toBe("0000012345678");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeGtin13("888-1234 567890")).toBe("8881234567890");
  });
});

describe("extractBarcodeFromText", () => {
  it("parses /barcode command", () => {
    expect(extractBarcodeFromText("/barcode 8881234567890")).toBe("8881234567890");
    expect(extractBarcodeFromText("/barcode@tryarnold_bot 012345678901")).toBe(
      "0012345678901",
    );
  });

  it("parses plain digit-only messages", () => {
    expect(extractBarcodeFromText("8881234567890")).toBe("8881234567890");
    expect(extractBarcodeFromText("888 1234 567890")).toBe("8881234567890");
  });

  it("ignores normal chat", () => {
    expect(extractBarcodeFromText("I ate 12 chicken nuggets")).toBeNull();
    expect(extractBarcodeFromText("120")).toBeNull();
    expect(extractBarcodeFromText("/barcode")).toBeNull();
  });

  it("detects barcode commands", () => {
    expect(isBarcodeCommand("/barcode 1")).toBe(true);
    expect(isBarcodeCommand("/help")).toBe(false);
  });
});

describe("extractBarcodeCandidate", () => {
  it("finds barcode digits inside caption text", () => {
    expect(extractBarcodeCandidate("barcode 8850157400107 please")).toBe(
      "8850157400107",
    );
    expect(extractBarcodeCandidate("UPC: 012345678901")).toBe("0012345678901");
  });

  it("prefers 13-digit runs over shorter ones", () => {
    expect(extractBarcodeCandidate("lot 12345678 code 8881234567890")).toBe(
      "8881234567890",
    );
  });

  it("ignores short number runs in normal captions", () => {
    expect(extractBarcodeCandidate("lunch for 2 people")).toBeNull();
  });
});

describe("barcode FatSecret helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses default serving and builds estimate from barcode food", () => {
    const food = parseFoodGetResponse({
      food: {
        food_id: "50953",
        food_name: "Whole Grain Cheerios",
        brand_name: "General Mills",
        food_type: "Brand",
        servings: {
          serving: [
            {
              serving_id: "100675",
              serving_description: "1 cup",
              metric_serving_amount: "30.000",
              metric_serving_unit: "g",
              is_default: "1",
              calories: "100",
              carbohydrate: "20.00",
              protein: "3.00",
              fat: "2.00",
            },
            {
              serving_id: "0",
              serving_description: "100 g",
              metric_serving_amount: "100.0",
              metric_serving_unit: "g",
              calories: "333",
              carbohydrate: "66.67",
              protein: "10.00",
              fat: "6.67",
            },
          ],
        },
      },
    });

    expect(food).not.toBeNull();
    expect(pickDefaultServing(food!.servings)?.serving_description).toBe("1 cup");

    const estimate = estimateFromBarcodeFood(food!, "0007400501001");
    expect(estimate.description).toContain("Cheerios");
    expect(estimate.calories).toBe(100);
    expect(estimate.items).toHaveLength(1);
    expect(estimate.assumptions.some((a) => a.startsWith("fatsecret:"))).toBe(true);
    expect(estimate.assumptions.some((a) => a.includes("barcode:"))).toBe(true);
    expect(estimate.portion?.container_type).toBe("packaged");
  });

  it("calls food.find_id_for_barcode.v2 with region SG by default", async () => {
    const settings = getSettings({
      PUBLIC_BASE_URL: "https://example.com",
      LOG_LEVEL: "DEBUG",
      FATSECRET_CONSUMER_KEY: "key",
      FATSECRET_CONSUMER_SECRET: "secret",
    } as Env);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          food: {
            food_id: "1",
            food_name: "Test Soda",
            brand_name: "Brand",
            servings: {
              serving: {
                serving_id: "10",
                serving_description: "1 can",
                is_default: "1",
                metric_serving_amount: "330",
                metric_serving_unit: "ml",
                calories: "140",
                carbohydrate: "39",
                protein: "0",
                fat: "0",
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const food = await findFoodByBarcode("08881234567890".slice(0, 13), settings);
    expect(food?.food_name).toBe("Test Soda");

    const body = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as string);
    expect(body.get("method")).toBe("food.find_id_for_barcode.v2");
    expect(body.get("region")).toBe("SG");
    expect(body.get("include_sub_categories")).toBe("true");
    expect(body.get("include_food_images")).toBe("true");
    expect(body.get("flag_default_serving")).toBe("true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to region TH when SG returns 211", async () => {
    const settings = getSettings({
      PUBLIC_BASE_URL: "https://example.com",
      LOG_LEVEL: "DEBUG",
      FATSECRET_CONSUMER_KEY: "key",
      FATSECRET_CONSUMER_SECRET: "secret",
    } as Env);

    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "211", message: "No food item detected" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            food: {
              food_id: "2",
              food_name: "Thai Snack",
              brand_name: "Brand",
              servings: {
                serving: {
                  serving_id: "20",
                  serving_description: "1 pack",
                  is_default: "1",
                  calories: "200",
                  carbohydrate: "20",
                  protein: "5",
                  fat: "10",
                },
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const food = await findFoodByBarcode("8850157400107", settings);
    expect(food?.food_name).toBe("Thai Snack");

    const first = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as string);
    const second = new URLSearchParams(fetchMock.mock.calls[1]![1]?.body as string);
    expect(first.get("region")).toBe("SG");
    expect(second.get("region")).toBe("TH");
  });

  it("returns null when SG and TH both miss", async () => {
    const settings = getSettings({
      PUBLIC_BASE_URL: "https://example.com",
      FATSECRET_CONSUMER_KEY: "key",
      FATSECRET_CONSUMER_SECRET: "secret",
    } as Env);

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: { code: "211", message: "No food item detected" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(findFoodByBarcode("0000000000000", settings)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
