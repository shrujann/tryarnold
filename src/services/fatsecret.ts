import type { Settings } from "../config";
import type { FoodItem, MacroEstimate } from "../schemas/nutrition";
import { createLogger } from "./logger";

export const FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api";

export const FATSECRET_ATTRIBUTION_TELEGRAM =
  '\n\n<a href="https://platform.fatsecret.com">Powered by fatsecret Platform API</a>';

export const FATSECRET_ATTRIBUTION_LINE =
  "\n\nPowered by fatsecret Platform API — https://platform.fatsecret.com";

export interface FatSecretServing {
  serving_id: string;
  serving_description: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  calories: string;
  carbohydrate: string;
  protein: string;
  fat: string;
}

export interface FatSecretFood {
  food_id: string;
  food_name: string;
  food_type?: string;
  brand_name?: string;
  food_description?: string;
  servings: FatSecretServing[];
}

export interface FatSecretSearchResult {
  total_results: number;
  foods: FatSecretFood[];
}

/** RFC 3986 percent-encoding for OAuth 1.0 parameter values. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildSignatureBaseString(
  method: string,
  url: string,
  params: Record<string, string>,
): string {
  const normalized = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key]!)}`)
    .join("&");
  return `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(normalized)}`;
}

export async function signOAuth1(
  baseString: string,
  consumerSecret: string,
): Promise<string> {
  const signingKey = `${percentEncode(consumerSecret)}&`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildSignedParams(
  consumerKey: string,
  consumerSecret: string,
  apiParams: Record<string, string>,
): Promise<Record<string, string>> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: randomNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };

  const allParams = { ...apiParams, ...oauthParams };
  const baseString = buildSignatureBaseString("POST", FATSECRET_API_URL, allParams);
  const signature = await signOAuth1(baseString, consumerSecret);

  return { ...allParams, oauth_signature: signature };
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseServing(raw: Record<string, unknown>): FatSecretServing {
  return {
    serving_id: String(raw.serving_id ?? ""),
    serving_description: String(raw.serving_description ?? ""),
    metric_serving_amount: raw.metric_serving_amount
      ? String(raw.metric_serving_amount)
      : undefined,
    metric_serving_unit: raw.metric_serving_unit
      ? String(raw.metric_serving_unit)
      : undefined,
    calories: String(raw.calories ?? "0"),
    carbohydrate: String(raw.carbohydrate ?? "0"),
    protein: String(raw.protein ?? "0"),
    fat: String(raw.fat ?? "0"),
  };
}

function parseFood(raw: Record<string, unknown>): FatSecretFood {
  const servingsRaw = (raw.servings as Record<string, unknown> | undefined)?.serving;
  return {
    food_id: String(raw.food_id ?? ""),
    food_name: String(raw.food_name ?? ""),
    food_type: raw.food_type ? String(raw.food_type) : undefined,
    brand_name: raw.brand_name ? String(raw.brand_name) : undefined,
    food_description: raw.food_description ? String(raw.food_description) : undefined,
    servings: asArray(servingsRaw).map((raw) =>
      parseServing(raw as Record<string, unknown>),
    ),
  };
}

function parseFatSecretError(body: unknown): string | null {
  const root = body as Record<string, unknown>;
  const error = root.error as Record<string, unknown> | undefined;
  if (!error) return null;
  const code = error.code != null ? String(error.code) : "?";
  const message = error.message != null ? String(error.message) : "unknown";
  return `${code}: ${message}`;
}

/** v5 uses `foods_search.results.food`; v1 uses `foods.food` (Basic tier). */
export function parseSearchResponse(body: unknown): FatSecretSearchResult {
  const root = body as Record<string, unknown>;
  const v5 = root.foods_search as Record<string, unknown> | undefined;
  if (v5) {
    const totalResults = parseInt(String(v5.total_results ?? "0"), 10);
    const results = (v5.results ?? {}) as Record<string, unknown>;
    const foods = asArray(results.food).map((raw) =>
      parseFood(raw as Record<string, unknown>),
    );
    return { total_results: totalResults, foods };
  }

  const v1 = root.foods as Record<string, unknown> | undefined;
  if (v1) {
    const totalResults = parseInt(String(v1.total_results ?? "0"), 10);
    const foods = asArray(v1.food).map((raw) =>
      parseFood(raw as Record<string, unknown>),
    );
    return { total_results: totalResults, foods };
  }

  return { total_results: 0, foods: [] };
}

export function parseFoodGetResponse(body: unknown): FatSecretFood | null {
  const root = body as Record<string, unknown>;
  const food = root.food as Record<string, unknown> | undefined;
  if (!food) return null;
  return parseFood(food);
}

export function pickServing(servings: FatSecretServing[]): FatSecretServing | null {
  if (!servings.length) return null;

  const hundredG = servings.find((s) => {
    const amount = parseFloat(s.metric_serving_amount ?? "");
    if (amount === 100 && (s.metric_serving_unit ?? "g").toLowerCase() === "g") {
      return true;
    }
    return /^100\s*g\b/i.test(s.serving_description);
  });

  return hundredG ?? servings[0]!;
}

function parseMacro(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function roundMacro(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildSearchExpression(item: FoodItem): string {
  return item.name.trim();
}

function servingToItemMacros(
  serving: FatSecretServing,
  plateShare: number | null | undefined,
): Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g"> {
  const share = plateShare != null && plateShare > 0 ? plateShare : 1;
  return {
    calories: roundMacro(parseMacro(serving.calories) * share),
    protein_g: roundMacro(parseMacro(serving.protein) * share),
    carbs_g: roundMacro(parseMacro(serving.carbohydrate) * share),
    fat_g: roundMacro(parseMacro(serving.fat) * share),
  };
}

/**
 * FatSecret returns database serving sizes (often 100 g). Vision estimates the
 * actual portion on the plate. Scale FS macros to match vision item calories
 * when both are available; keep vision when FS serving is zero-calorie.
 */
export function blendItemMacrosWithVision(
  item: FoodItem,
  fatsecret: Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g">,
): Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g"> {
  const visionCal = item.calories;
  const fsCal = fatsecret.calories;

  if (fsCal <= 0 && visionCal > 0) {
    return {
      calories: roundMacro(visionCal),
      protein_g: roundMacro(item.protein_g),
      carbs_g: roundMacro(item.carbs_g),
      fat_g: roundMacro(item.fat_g),
    };
  }

  if (visionCal <= 0 || fsCal <= 0) {
    return fatsecret;
  }

  const ratio = visionCal / fsCal;
  if (ratio > 0 && ratio <= 10) {
    return {
      calories: roundMacro(fatsecret.calories * ratio),
      protein_g: roundMacro(fatsecret.protein_g * ratio),
      carbs_g: roundMacro(fatsecret.carbs_g * ratio),
      fat_g: roundMacro(fatsecret.fat_g * ratio),
    };
  }

  return {
    calories: roundMacro(visionCal),
    protein_g: roundMacro(item.protein_g),
    carbs_g: roundMacro(item.carbs_g),
    fat_g: roundMacro(item.fat_g),
  };
}

function sumItems(items: FoodItem[]): Pick<
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

async function callFatSecretApi(
  settings: Settings,
  apiParams: Record<string, string>,
): Promise<unknown> {
  const signedParams = await buildSignedParams(
    settings.fatsecretConsumerKey!,
    settings.fatsecretConsumerSecret!,
    apiParams,
  );

  const body = new URLSearchParams(signedParams).toString();
  const resp = await fetch(FATSECRET_API_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    throw new Error(`FatSecret API HTTP ${resp.status}`);
  }

  return resp.json();
}

/** Basic tier: v1 search (v5 returns "Unknown method"). */
export async function searchFoods(
  searchExpression: string,
  settings: Settings,
): Promise<FatSecretSearchResult> {
  const logger = createLogger(settings.logLevel);
  const method = "foods.search";

  const apiParams: Record<string, string> = {
    method,
    search_expression: searchExpression,
    format: "json",
    max_results: "5",
    page_number: "0",
  };

  logger.debug({
    stage: "fatsecret_request",
    search_expression: searchExpression,
    method,
    max_results: 5,
  });

  const json = await callFatSecretApi(settings, apiParams);
  const apiError = parseFatSecretError(json);
  if (apiError) {
    throw new Error(`FatSecret API error: ${apiError}`);
  }

  const parsed = parseSearchResponse(json);
  const topMatch = parsed.foods[0];

  logger.debug({
    stage: "fatsecret_response",
    search_expression: searchExpression,
    total_results: parsed.total_results,
    top_match: topMatch?.food_name ?? null,
    top_food_id: topMatch?.food_id ?? null,
    serving_count: topMatch?.servings.length ?? 0,
  });

  return parsed;
}

/** v1 search has no servings — fetch full food record by id. */
export async function getFoodById(
  foodId: string,
  settings: Settings,
): Promise<FatSecretFood | null> {
  const logger = createLogger(settings.logLevel);
  const method = "food.get";

  logger.debug({
    stage: "fatsecret_request",
    method,
    food_id: foodId,
  });

  const json = await callFatSecretApi(settings, {
    method,
    food_id: foodId,
    format: "json",
  });

  const apiError = parseFatSecretError(json);
  if (apiError) {
    throw new Error(`FatSecret API error: ${apiError}`);
  }

  const food = parseFoodGetResponse(json);
  const servingUsed = food ? pickServing(food.servings) : null;

  logger.debug({
    stage: "fatsecret_response",
    method,
    food_id: foodId,
    food_name: food?.food_name ?? null,
    serving_used: servingUsed?.serving_description ?? null,
    macros: servingUsed
      ? {
          calories: servingUsed.calories,
          protein: servingUsed.protein,
          carbs: servingUsed.carbohydrate,
          fat: servingUsed.fat,
        }
      : null,
  });

  return food;
}

export function hasFatSecretAssumption(assumptions: string[]): boolean {
  return assumptions.some((a) => a.startsWith("fatsecret:"));
}

export async function enrichEstimateWithFatSecret(
  estimate: MacroEstimate,
  settings: Settings,
): Promise<{ estimate: MacroEstimate; fatsecretUsed: boolean }> {
  const logger = createLogger(settings.logLevel);

  if (!settings.fatsecretEnabled || !estimate.items.length) {
    return { estimate, fatsecretUsed: false };
  }

  let anyMatched = false;
  const assumptions = [...estimate.assumptions];
  const enrichedItems: FoodItem[] = [];

  for (const item of estimate.items) {
    const searchExpression = buildSearchExpression(item);
    if (!searchExpression) {
      enrichedItems.push(item);
      continue;
    }

    try {
      const result = await searchFoods(searchExpression, settings);
      const topHit = result.foods[0];
      if (!topHit || result.total_results <= 0) {
        logger.warn({
          stage: "fatsecret_response",
          search_expression: searchExpression,
          message: "no match, keeping vision macros",
        });
        enrichedItems.push(item);
        continue;
      }

      const topFood =
        topHit.servings.length > 0
          ? topHit
          : (await getFoodById(topHit.food_id, settings)) ?? topHit;

      const serving = pickServing(topFood.servings);
      if (!serving) {
        logger.warn({
          stage: "fatsecret_response",
          search_expression: searchExpression,
          message: "no serving data, keeping vision macros",
        });
        enrichedItems.push(item);
        continue;
      }

      anyMatched = true;
      const fsMacros = servingToItemMacros(serving, item.plate_share);
      const macros = blendItemMacrosWithVision(item, fsMacros);
      assumptions.push(`fatsecret: ${topFood.food_name} (${serving.serving_description})`);
      enrichedItems.push({ ...item, ...macros });
    } catch (err) {
      logger.warn({
        stage: "fatsecret_response",
        search_expression: searchExpression,
        message: "API error, keeping vision macros",
        error: err instanceof Error ? err.message : String(err),
      });
      enrichedItems.push(item);
    }
  }

  if (!anyMatched) {
    return { estimate, fatsecretUsed: false };
  }

  const totals = sumItems(enrichedItems);
  const enriched: MacroEstimate = {
    ...estimate,
    ...totals,
    items: enrichedItems,
    assumptions,
    food_confidence: Math.max(estimate.food_confidence, 0.85),
  };

  logger.info({
    stage: "fatsecret_enrichment",
    fatsecretUsed: true,
    calories: enriched.calories,
    items: enriched.items.map((i) => i.name),
  });

  return { estimate: enriched, fatsecretUsed: true };
}
