import type { ButtonRow } from "../channels/types";
import type {
  ClarificationSpec,
  ClarifyExclusive,
  FoodItem,
  MacroEstimate,
} from "../schemas/nutrition";
import { normalizePortionEstimate } from "../schemas/nutrition";

export type ClarifyPlan = ClarificationSpec & { introText: string };

const TOGGLE_TEMPLATES: Record<string, FoodItem> = {
  added_sugar: {
    name: "sugar",
    weight_g: 5,
    calories: 20,
    protein_g: 0,
    carbs_g: 5,
    fat_g: 0,
  },
  condensed_milk: {
    name: "condensed milk",
    volume_ml: 30,
    weight_g: 30,
    calories: 90,
    protein_g: 2,
    carbs_g: 15,
    fat_g: 2,
  },
  cream: {
    name: "cream",
    volume_ml: 15,
    weight_g: 15,
    calories: 50,
    protein_g: 0.5,
    carbs_g: 1,
    fat_g: 5,
  },
};

const OIL_LEVELS: Record<string, FoodItem> = {
  light: {
    name: "cooking oil",
    weight_g: 5,
    calories: 45,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 5,
  },
  medium: {
    name: "cooking oil",
    weight_g: 10,
    calories: 90,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 10,
  },
  heavy: {
    name: "cooking oil",
    weight_g: 15,
    calories: 135,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 15,
  },
};

function isDrink(estimate: MacroEstimate): boolean {
  if (estimate.portion?.container_type === "cup") return true;
  return (estimate.items ?? []).some(
    (item) => item.volume_ml != null && item.volume_ml > 0,
  );
}

function hasSweetenerItem(estimate: MacroEstimate): boolean {
  return (estimate.items ?? []).some((item) =>
    /sugar|sweetener|syrup|honey/i.test(item.name),
  );
}

function dedupeToggles(
  toggles: ClarificationSpec["toggles"],
): ClarificationSpec["toggles"] {
  const seen = new Set<string>();
  const out: ClarificationSpec["toggles"] = [];
  for (const toggle of toggles) {
    if (seen.has(toggle.id)) continue;
    seen.add(toggle.id);
    out.push(toggle);
    if (out.length >= 4) break;
  }
  return out;
}

export function buildClarifyPlan(
  estimate: MacroEstimate,
  clarification: ClarificationSpec,
): ClarifyPlan {
  const toggles = dedupeToggles([...clarification.toggles]);

  if (isDrink(estimate) && !hasSweetenerItem(estimate)) {
    if (!toggles.some((t) => t.id === "added_sugar")) {
      toggles.push({ id: "added_sugar", label: "Sugar" });
    }
  }

  let introText = "Anything else in this meal? (tap to toggle)";
  if (isDrink(estimate)) {
    const names = (estimate.items ?? [])
      .slice(0, 2)
      .map((item) => item.name)
      .join(" + ");
    introText = names
      ? `I see ${names}. Anything else in this drink? (tap to toggle)`
      : "Anything else in this drink? (tap to toggle)";
  }

  return {
    toggles: dedupeToggles(toggles),
    exclusive: clarification.exclusive ?? ruleBasedExclusive(estimate),
    introText,
  };
}

function ruleBasedExclusive(estimate: MacroEstimate): ClarifyExclusive | null {
  const text = `${estimate.description} ${(estimate.items ?? []).map((i) => i.name).join(" ")}`;
  const looksFried = /fried|rice|noodle|stir.?fry|wok|glossy|oily/i.test(text);
  const hasOilItem = (estimate.items ?? []).some((i) => /\boil\b/i.test(i.name));
  if (looksFried && !hasOilItem) {
    return {
      id: "cooking_oil",
      prompt: "How oily does it look?",
      options: [
        { id: "light", label: "Light" },
        { id: "medium", label: "Medium" },
        { id: "heavy", label: "Heavy" },
      ],
    };
  }
  return null;
}

export function toggleSelection(
  selectedIds: string[],
  toggleId: string,
): string[] {
  const set = new Set(selectedIds);
  if (set.has(toggleId)) set.delete(toggleId);
  else set.add(toggleId);
  return [...set];
}

export function clearToggles(): string[] {
  return [];
}

export function mergeClarifyIntoDraft(
  draft: MacroEstimate,
  selectedToggleIds: string[],
  exclusiveChoiceId: string | null,
): MacroEstimate {
  const items: FoodItem[] = [...(draft.items ?? [])];

  for (const id of selectedToggleIds) {
    const template = TOGGLE_TEMPLATES[id];
    if (template) items.push({ ...template });
  }

  if (exclusiveChoiceId) {
    const oil = OIL_LEVELS[exclusiveChoiceId];
    if (oil) items.push({ ...oil });
  }

  return normalizePortionEstimate({ ...draft, items });
}

/** Candidate hidden items to prefetch (FatSecret) before the user selects toggles. */
export function buildClarifyPrefetchCandidates(
  scaledDraft: MacroEstimate,
  plan: ClarifyPlan,
): { visible: MacroEstimate; addOns: Array<{ key: string; item: FoodItem }> } {
  const addOns: Array<{ key: string; item: FoodItem }> = [];

  for (const toggle of plan.toggles) {
    const template = TOGGLE_TEMPLATES[toggle.id];
    if (template) addOns.push({ key: toggle.id, item: { ...template } });
  }

  if (plan.exclusive) {
    for (const option of plan.exclusive.options) {
      const oil = OIL_LEVELS[option.id];
      if (oil) addOns.push({ key: `exclusive:${option.id}`, item: { ...oil } });
    }
  }

  return { visible: scaledDraft, addOns };
}

export function formatToggleMessage(plan: ClarifyPlan): string {
  return plan.introText;
}

export function formatExclusiveMessage(exclusive: ClarifyExclusive): string {
  return exclusive.prompt;
}

export function buildToggleKeyboard(
  plan: ClarifyPlan,
  selectedIds: string[],
): ButtonRow[] {
  const rows: ButtonRow[] = [];
  const buttons = plan.toggles.map((toggle) => {
    const checked = selectedIds.includes(toggle.id);
    return {
      label: checked ? `✓ ${toggle.label}` : toggle.label,
      data: `meal:toggle:${toggle.id}`,
    };
  });

  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }

  rows.push([
    { label: "None", data: "meal:clarify:none" },
    { label: "Calculate →", data: "meal:clarify:done" },
  ]);
  return rows;
}

export function buildExclusiveKeyboard(exclusive: ClarifyExclusive): ButtonRow[] {
  const rows: ButtonRow[] = [];
  const buttons = exclusive.options.map((option) => ({
    label: option.label,
    data: `meal:exclusive:${option.id}`,
  }));

  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }

  rows.push([{ label: "None", data: "meal:exclusive:none" }]);
  return rows;
}

export type ClarifyCallbackAction =
  | { type: "toggle"; id: string }
  | { type: "clarify_none" }
  | { type: "clarify_done" }
  | { type: "exclusive"; id: string }
  | { type: "exclusive_none" };

export function parseClarifyCallback(data: string): ClarifyCallbackAction | null {
  if (!data.startsWith("meal:")) return null;
  if (data.startsWith("meal:toggle:")) {
    return { type: "toggle", id: data.slice("meal:toggle:".length) };
  }
  if (data === "meal:clarify:none") return { type: "clarify_none" };
  if (data === "meal:clarify:done") return { type: "clarify_done" };
  if (data.startsWith("meal:exclusive:")) {
    const id = data.slice("meal:exclusive:".length);
    if (id === "none") return { type: "exclusive_none" };
    return { type: "exclusive", id };
  }
  return null;
}

export function isClarifyCallback(data: string): boolean {
  return parseClarifyCallback(data) !== null;
}
