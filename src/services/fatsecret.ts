import type { Settings } from "../config";
import type { FoodItem, MacroEstimate } from "../schemas/nutrition";
import { normalizePortionEstimate } from "../schemas/nutrition";
import {
  buildClarifyPrefetchCandidates,
  type ClarifyPlan,
} from "./clarification";
import { expandCompoundItems } from "./item-split";
import { createLogger } from "./logger";

export const FATSECRET_API_URL = "https://platform.fatsecret.com/rest/server.api";

export const FATSECRET_ATTRIBUTION_TELEGRAM =
  '\n\n<a href="https://platform.fatsecret.com">Powered by fatsecret Platform API</a>';

export const FATSECRET_ATTRIBUTION_LINE =
  "\n\nPowered by fatsecret Platform API — https://platform.fatsecret.com";

export const WEIGHT_UNCERTAIN_ASSUMPTION =
  "Weight may not be accurate for this dish";

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

export function servingMetricAmount(
  serving: FatSecretServing,
): { amount: number; unit: "g" | "ml" } | null {
  const amount = parseFloat(serving.metric_serving_amount ?? "");
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unitRaw = (serving.metric_serving_unit ?? "g").toLowerCase();
  if (unitRaw === "ml" || unitRaw === "milliliter" || unitRaw === "millilitre") {
    return { amount, unit: "ml" };
  }
  if (unitRaw === "g" || unitRaw === "gram" || unitRaw === "grams") {
    return { amount, unit: "g" };
  }
  return { amount, unit: "g" };
}

export function pickServing(
  servings: FatSecretServing[],
  item?: FoodItem,
): FatSecretServing | null {
  if (!servings.length) return null;

  const visionWeight = item?.weight_g ?? 0;
  const visionVolume = item?.volume_ml ?? 0;

  if (visionWeight > 0 || visionVolume > 0) {
    const candidates: Array<{ serving: FatSecretServing; delta: number }> = [];
    const preferWeight = visionWeight > 0;

    for (const serving of servings) {
      const metric = servingMetricAmount(serving);
      if (!metric) continue;

      if (preferWeight && metric.unit === "g") {
        candidates.push({
          serving,
          delta: Math.abs(visionWeight - metric.amount),
        });
      } else if (!preferWeight && visionVolume > 0 && metric.unit === "ml") {
        candidates.push({
          serving,
          delta: Math.abs(visionVolume - metric.amount),
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.delta - b.delta);
      return candidates[0]!.serving;
    }
  }

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

function isLiquidItem(item: FoodItem): boolean {
  return /milk|coffee|tea|latte|espresso|juice|water|cream|soda|cola|drink/i.test(
    item.name,
  );
}

function visionPortionAmount(item: FoodItem): number | null {
  const hasVolume = item.volume_ml != null && item.volume_ml > 0;
  if (item.weight_g === 0 && !hasVolume) {
    if (/ice|garnish|water\b/i.test(item.name)) return 0;
    return null;
  }
  if (item.weight_g > 0) return item.weight_g;
  if (hasVolume) return item.volume_ml!;
  return null;
}

function visionToServingRatio(
  item: FoodItem,
  metric: { amount: number; unit: "g" | "ml" },
): number | null {
  if (metric.amount <= 0) return null;

  if (metric.unit === "g" && item.weight_g > 0) {
    return item.weight_g / metric.amount;
  }

  if (metric.unit === "ml") {
    const ml =
      item.volume_ml != null && item.volume_ml > 0
        ? item.volume_ml
        : isLiquidItem(item)
          ? item.weight_g
          : 0;
    if (ml > 0) return ml / metric.amount;
  }

  if (metric.unit === "g" && isLiquidItem(item) && item.volume_ml != null && item.volume_ml > 0) {
    return item.volume_ml / metric.amount;
  }

  return null;
}

function scaleFsMacros(
  fatsecret: Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g">,
  ratio: number,
): Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g"> {
  const clamped = Math.min(Math.max(ratio, 0), 10);
  return {
    calories: roundMacro(fatsecret.calories * clamped),
    protein_g: roundMacro(fatsecret.protein_g * clamped),
    carbs_g: roundMacro(fatsecret.carbs_g * clamped),
    fat_g: roundMacro(fatsecret.fat_g * clamped),
  };
}

/**
 * Scale FatSecret macros by vision portion (weight_g / volume_ml).
 * Vision supplies physical amount; FatSecret supplies per-serving nutrition.
 */
export function blendItemMacrosWithVision(
  item: FoodItem,
  fatsecret: Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g">,
  serving?: FatSecretServing,
): Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g"> {
  const portion = visionPortionAmount(item);
  if (portion === 0) {
    return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  }

  const metric = serving ? servingMetricAmount(serving) : null;
  if (portion != null && portion > 0 && metric) {
    const ratio = visionToServingRatio(item, metric);
    if (ratio != null && ratio > 0) {
      return scaleFsMacros(fatsecret, ratio);
    }
  }

  return fatsecret;
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

/** Scale item P/C/F to match meal-level vision macros; keep per-item calories. */
export function reconcileItemMacrosToMeal(
  items: FoodItem[],
  mealMacros: Pick<MacroEstimate, "protein_g" | "carbs_g" | "fat_g">,
): FoodItem[] {
  const totals = sumItems(items);
  const fields: Array<keyof Pick<MacroEstimate, "protein_g" | "carbs_g" | "fat_g">> = [
    "protein_g",
    "carbs_g",
    "fat_g",
  ];

  const scaled = items.map((item) => {
    const next = { ...item };
    for (const field of fields) {
      const itemTotal = totals[field];
      const target = mealMacros[field];
      if (itemTotal <= 0 || target <= 0) {
        next[field] = item[field];
        continue;
      }
      next[field] = roundMacro(item[field] * (target / itemTotal));
    }
    return next;
  });

  for (const field of fields) {
    const target = mealMacros[field];
    const sum = roundMacro(scaled.reduce((acc, item) => acc + item[field], 0));
    const drift = roundMacro(target - sum);
    if (drift !== 0 && scaled.length > 0) {
      const last = scaled[scaled.length - 1]!;
      scaled[scaled.length - 1] = {
        ...last,
        [field]: roundMacro(last[field] + drift),
      };
    }
  }

  return scaled;
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
    signal: AbortSignal.timeout(FATSECRET_FETCH_TIMEOUT_MS),
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

export type FatSecretEnrichmentResult = {
  estimate: MacroEstimate;
  fatsecretUsed: boolean;
};

/** Cached FatSecret lookups for visible items + all clarify candidates. */
export type FatSecretPrefetchCache = {
  visibleItems: FoodItem[];
  addOns: Record<string, FoodItem>;
  assumptions: string[];
  fatsecretUsed: boolean;
};

const FATSECRET_FETCH_TIMEOUT_MS = 12_000;

async function enrichVisibleItemsForPrefetch(
  scaledDraft: MacroEstimate,
  settings: Settings,
): Promise<{ items: FoodItem[]; fatsecretUsed: boolean; assumptions: string[] }> {
  const logger = createLogger(settings.logLevel);
  if (!settings.fatsecretEnabled || !(scaledDraft.items ?? []).length) {
    return {
      items: scaledDraft.items ?? [],
      fatsecretUsed: false,
      assumptions: [...scaledDraft.assumptions],
    };
  }

  const { items, anyMatched, assumptions } = await enrichItemListWithFatSecret(
    scaledDraft.items,
    settings,
    logger,
    scaledDraft.assumptions,
  );

  return { items, fatsecretUsed: anyMatched, assumptions };
}

async function runClarifyFatSecretPrefetch(
  scaledDraft: MacroEstimate,
  plan: ClarifyPlan,
  settings: Settings,
): Promise<FatSecretPrefetchCache> {
  const logger = createLogger(settings.logLevel);
  const { addOns: candidates } = buildClarifyPrefetchCandidates(scaledDraft, plan);

  const [visible, ...addOnResults] = await Promise.all([
    enrichVisibleItemsForPrefetch(scaledDraft, settings),
    ...candidates.map(async ({ key, item }) => {
      const { items, anyMatched, assumptions } = await enrichItemListWithFatSecret(
        [item],
        settings,
        logger,
        [],
      );
      return { key, item: items[0] ?? item, anyMatched, assumptions };
    }),
  ]);

  const addOnMap: Record<string, FoodItem> = {};
  let fatsecretUsed = visible.fatsecretUsed;
  const assumptions = [...visible.assumptions];

  for (const result of addOnResults) {
    addOnMap[result.key] = result.item;
    if (result.anyMatched) {
      fatsecretUsed = true;
      for (const note of result.assumptions) {
        if (!assumptions.includes(note)) assumptions.push(note);
      }
    }
  }

  return {
    visibleItems: visible.items,
    addOns: addOnMap,
    assumptions,
    fatsecretUsed,
  };
}

/** Fetch FatSecret for visible items + all clarify toggle/exclusive candidates. */
export async function fetchClarifyNutritionCache(
  scaledDraft: MacroEstimate,
  plan: ClarifyPlan,
  settings: Settings,
): Promise<FatSecretPrefetchCache> {
  const logger = createLogger(settings.logLevel);
  const started = Date.now();

  const cache = await runClarifyFatSecretPrefetch(scaledDraft, plan, settings);

  logger.info({
    stage: "fatsecret_fetch",
    fatsecretUsed: cache.fatsecretUsed,
    visibleItems: cache.visibleItems.map((i) => i.name),
    addOnKeys: Object.keys(cache.addOns),
    durationMs: Date.now() - started,
  });

  return cache;
}

export function parseFatSecretPrefetch(
  row: { fatsecret_prefetch_json?: string | null },
): FatSecretPrefetchCache | null {
  if (!row.fatsecret_prefetch_json) return null;
  try {
    const parsed = JSON.parse(row.fatsecret_prefetch_json);
    if (parsed?.visibleItems && parsed?.addOns) {
      return parsed as FatSecretPrefetchCache;
    }
    // Legacy shape stored full estimate — treat as visible-only cache.
    if (parsed?.estimate?.items) {
      return {
        visibleItems: parsed.estimate.items,
        addOns: {},
        assumptions: parsed.estimate.assumptions ?? [],
        fatsecretUsed: Boolean(parsed.fatsecretUsed),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function assumptionsForItems(
  allAssumptions: string[],
  items: FoodItem[],
): string[] {
  const names = new Set(items.map((i) => i.name.toLowerCase()));
  return allAssumptions.filter((note) => {
    if (!note.startsWith("fatsecret:")) return true;
    const body = note.slice("fatsecret:".length).toLowerCase();
    return [...names].some((name) => body.includes(name));
  });
}

/** Build final meal from prefetch cache + user selections only (no API calls). */
export function assembleMealFromPrefetchCache(
  scaledDraft: MacroEstimate,
  selectedToggleIds: string[],
  exclusiveChoiceId: string | null,
  cache: FatSecretPrefetchCache,
): FatSecretEnrichmentResult {
  const items: FoodItem[] = [...cache.visibleItems];

  for (const id of selectedToggleIds) {
    const enriched = cache.addOns[id];
    if (enriched) items.push({ ...enriched });
  }

  if (exclusiveChoiceId) {
    const enriched = cache.addOns[`exclusive:${exclusiveChoiceId}`];
    if (enriched) items.push({ ...enriched });
  }

  const totals = sumItems(items);
  const mealAssumptions = assumptionsForItems(cache.assumptions, items);
  const fatsecretUsed = mealAssumptions.some((a) => a.startsWith("fatsecret:"));

  return {
    estimate: normalizePortionEstimate({
      ...scaledDraft,
      ...totals,
      items,
      assumptions: mealAssumptions,
      food_confidence: Math.max(
        scaledDraft.food_confidence,
        fatsecretUsed ? 0.85 : 0,
      ),
    }),
    fatsecretUsed,
  };
}

function applyFatSecretNutritionToItem(
  item: FoodItem,
  macros: Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g">,
): FoodItem {
  return {
    ...item,
    calories: macros.calories,
    protein_g: macros.protein_g,
    carbs_g: macros.carbs_g,
    fat_g: macros.fat_g,
  };
}

async function enrichItemListWithFatSecret(
  items: FoodItem[],
  settings: Settings,
  logger: ReturnType<typeof createLogger>,
  initialAssumptions: string[] = [],
): Promise<{ items: FoodItem[]; anyMatched: boolean; assumptions: string[] }> {
  const { items: expandedItems, splitNotes } = expandCompoundItems(items);
  const assumptions = [...initialAssumptions, ...splitNotes];
  let weightUncertain = false;

  const results = await Promise.all(
    expandedItems.map(async (item) => {
      const searchExpression = buildSearchExpression(item);
      if (!searchExpression) {
        return {
          item,
          matched: false,
          notes: [`nutrition: vision estimate (no fatsecret match for ${item.name})`] as string[],
        };
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
          return {
            item,
            matched: false,
            notes: [`nutrition: vision estimate (no fatsecret match for ${item.name})`],
          };
        }

        const topFood =
          topHit.servings.length > 0
            ? topHit
            : (await getFoodById(topHit.food_id, settings)) ?? topHit;

        const serving = pickServing(topFood.servings, item);
        if (!serving) {
          logger.warn({
            stage: "fatsecret_response",
            search_expression: searchExpression,
            message: "no serving data, keeping vision macros",
          });
          return {
            item,
            matched: false,
            notes: [`nutrition: vision estimate (no fatsecret match for ${item.name})`],
          };
        }

        const fsMacros = servingToItemMacros(serving, item.plate_share);
        const macros = blendItemMacrosWithVision(item, fsMacros, serving);
        const notes = [`fatsecret: ${topFood.food_name} (${serving.serving_description})`];
        if (visionPortionAmount(item) == null) {
          weightUncertain = true;
        }
        return {
          item: applyFatSecretNutritionToItem(item, macros),
          matched: true,
          notes,
        };
      } catch (err) {
        logger.warn({
          stage: "fatsecret_response",
          search_expression: searchExpression,
          message: "API error, keeping vision macros",
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          item,
          matched: false,
          notes: [`nutrition: vision estimate (no fatsecret match for ${item.name})`],
        };
      }
    }),
  );

  let anyMatched = false;
  const enrichedItems: FoodItem[] = [];
  for (const result of results) {
    enrichedItems.push(result.item);
    if (result.matched) {
      anyMatched = true;
    }
    for (const note of result.notes) {
      if (!assumptions.includes(note)) assumptions.push(note);
    }
  }

  if (weightUncertain && !assumptions.includes(WEIGHT_UNCERTAIN_ASSUMPTION)) {
    assumptions.push(WEIGHT_UNCERTAIN_ASSUMPTION);
  }

  return { items: enrichedItems, anyMatched, assumptions };
}

export async function enrichEstimateWithFatSecret(
  estimate: MacroEstimate,
  settings: Settings,
): Promise<{ estimate: MacroEstimate; fatsecretUsed: boolean }> {
  const logger = createLogger(settings.logLevel);

  if (!settings.fatsecretEnabled || !estimate.items.length) {
    return { estimate, fatsecretUsed: false };
  }

  const { items: enrichedItems, anyMatched, assumptions } =
    await enrichItemListWithFatSecret(
      estimate.items,
      settings,
      logger,
      estimate.assumptions,
    );

  if (!anyMatched) {
    return { estimate, fatsecretUsed: false };
  }

  const finalItems = enrichedItems;
  const totals = sumItems(finalItems);
  const enriched: MacroEstimate = {
    ...estimate,
    ...totals,
    items: finalItems,
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
