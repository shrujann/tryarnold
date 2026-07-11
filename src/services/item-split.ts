import type { FoodItem } from "../schemas/nutrition";

const COMPOUND_PATTERN = /\s+(?:with|and)\s+|[+,/]/i;
const WITH_PATTERN = /\s+with\s+/i;

const SEARCH_ALIASES: Record<string, string> = {
  sweetener: "sugar substitute",
  espresso: "coffee",
};

const NEGLIGIBLE_NAMES = new Set(["ice", "water"]);

function roundMacro(n: number): number {
  return Math.round(n * 10) / 10;
}

export function isNegligibleItemName(name: string): boolean {
  return NEGLIGIBLE_NAMES.has(name.toLowerCase().trim());
}

function aliasForSearch(name: string): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  return SEARCH_ALIASES[lower] ?? trimmed;
}

function isCompoundName(name: string): boolean {
  return COMPOUND_PATTERN.test(name.trim());
}

function splitCompoundName(name: string): string[] {
  return name
    .split(COMPOUND_PATTERN)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isSweetenerLike(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("sweetener") ||
    lower.includes("sugar substitute") ||
    lower === "sugar" ||
    lower.includes("syrup")
  );
}

/** Heuristic calorie/macro weights when splitting a compound item name. */
function splitWeights(rawParts: string[], originalName: string): number[] {
  const parts = rawParts.map((p) => p.toLowerCase());
  if (parts.length <= 1) return [1];

  if (WITH_PATTERN.test(originalName)) {
    const sweetIdx = parts.findIndex(isSweetenerLike);
    if (sweetIdx >= 0 && parts.length === 2) {
      const weights = [0.85, 0.15];
      if (sweetIdx === 0) return [0.15, 0.85];
      return weights;
    }
    return parts.map(() => 1 / parts.length);
  }

  return parts.map(() => 1 / parts.length);
}

function allocateMacros(
  parent: FoodItem,
  parts: string[],
  weights: number[],
): FoodItem[] {
  const wSum = weights.reduce((a, b) => a + b, 0) || 1;
  const normalized = weights.map((w) => w / wSum);

  const fields: Array<keyof Pick<FoodItem, "calories" | "protein_g" | "carbs_g" | "fat_g">> = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
  ];

  const allocated: FoodItem[] = parts.map((part, idx) => ({
    name: aliasForSearch(part),
    quantity: parent.quantity,
    plate_share: parent.plate_share,
    weight_g: 0,
    volume_ml: null,
    volume_fraction: null,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
  }));

  for (const field of fields) {
    const total = parent[field] ?? 0;
    let assigned = 0;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const value = isLast
        ? roundMacro((total as number) - assigned)
        : roundMacro((total as number) * normalized[i]!);
      allocated[i]![field] = value;
      assigned = roundMacro(assigned + value);
    }
  }

  const parentWeight = parent.weight_g ?? 0;
  if (parentWeight > 0) {
    let assignedWeight = 0;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const value = isLast
        ? roundMacro(parentWeight - assignedWeight)
        : roundMacro(parentWeight * normalized[i]!);
      allocated[i]!.weight_g = value;
      assignedWeight = roundMacro(assignedWeight + value);
    }
  }

  const parentVolume = parent.volume_ml;
  if (parentVolume != null && parentVolume > 0) {
    let assignedVolume = 0;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const value = isLast
        ? roundMacro(parentVolume - assignedVolume)
        : roundMacro(parentVolume * normalized[i]!);
      allocated[i]!.volume_ml = value;
      assignedVolume = roundMacro(assignedVolume + value);
    }
  }

  const parentVolumeFraction = parent.volume_fraction;
  if (parentVolumeFraction != null && parentVolumeFraction > 0) {
    let assignedFraction = 0;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const value = isLast
        ? roundMacro(parentVolumeFraction - assignedFraction)
        : roundMacro(parentVolumeFraction * normalized[i]!);
      allocated[i]!.volume_fraction = value;
      assignedFraction = roundMacro(assignedFraction + value);
    }
  }

  return allocated;
}

function mergeIntoLargest(items: FoodItem[]): FoodItem[] {
  if (items.length <= 1) return items;

  let largestIdx = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.calories > items[largestIdx]!.calories) largestIdx = i;
  }

  const mergeIdx = items.findIndex(
    (item, idx) => idx !== largestIdx && isNegligibleItemName(item.name),
  );
  if (mergeIdx < 0) return items;

  const target = items[largestIdx]!;
  const source = items[mergeIdx]!;
  const merged: FoodItem = {
    ...target,
    weight_g: roundMacro((target.weight_g ?? 0) + (source.weight_g ?? 0)),
    volume_ml:
      target.volume_ml != null || source.volume_ml != null
        ? roundMacro((target.volume_ml ?? 0) + (source.volume_ml ?? 0))
        : null,
    calories: roundMacro(target.calories + source.calories),
    protein_g: roundMacro(target.protein_g + source.protein_g),
    carbs_g: roundMacro(target.carbs_g + source.carbs_g),
    fat_g: roundMacro(target.fat_g + source.fat_g),
  };

  return items
    .map((item, idx) => (idx === largestIdx ? merged : item))
    .filter((_, idx) => idx !== mergeIdx);
}

function capItems(items: FoodItem[], maxItems: number): FoodItem[] {
  let result = [...items];
  while (result.length > maxItems) {
    const before = result.length;
    result = mergeIntoLargest(result);
    if (result.length >= before) break;
  }
  return result.slice(0, maxItems);
}

export interface ExpandCompoundItemsResult {
  items: FoodItem[];
  splitNotes: string[];
}

/**
 * Split compound vision item names (e.g. "espresso with sweetener") into atomic
 * FatSecret-searchable rows before enrichment.
 */
export function expandCompoundItems(
  items: FoodItem[],
  maxItems = 5,
): ExpandCompoundItemsResult {
  const splitNotes: string[] = [];
  const expanded: FoodItem[] = [];

  for (const item of items) {
    const name = item.name?.trim() ?? "";
    if (!name || !isCompoundName(name)) {
      expanded.push({ ...item, name: aliasForSearch(name) });
      continue;
    }

    const rawParts = splitCompoundName(name);
    if (rawParts.length <= 1) {
      expanded.push({ ...item, name: aliasForSearch(name) });
      continue;
    }

    const weights = splitWeights(rawParts, name);
    const children = allocateMacros(item, rawParts, weights);
    const aliased = children.map((child) => ({
      ...child,
      name: aliasForSearch(child.name),
    }));

    splitNotes.push(
      `split: ${name} → ${aliased.map((c) => c.name).join(", ")}`,
    );
    expanded.push(...aliased);
  }

  return {
    items: capItems(expanded, maxItems),
    splitNotes,
  };
}
