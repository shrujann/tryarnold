import type { MacroEstimate } from "../schemas/nutrition";

export type HighlightedChange = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type ProposedMealEdit = {
  estimate: MacroEstimate;
  highlighted_change: HighlightedChange | null;
};

export type EditReviewAction = "apply_edit" | "edit_again";

export function parseEditReviewAction(raw: string): EditReviewAction | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;

  if (
    token === "meal:apply_edit" ||
    token === "apply_edit" ||
    token === "adjust" ||
    token === "yes" ||
    token === "y" ||
    token === "ok" ||
    token === "confirm"
  ) {
    return "apply_edit";
  }

  if (
    token === "meal:edit_again" ||
    token === "edit_again" ||
    token === "edit" ||
    token === "no" ||
    token === "n"
  ) {
    return "edit_again";
  }

  return null;
}

export function editReviewButtons(): Array<Array<{ label: string; data: string }>> {
  return [
    [
      { label: "Adjust", data: "meal:apply_edit" },
      { label: "Edit again", data: "meal:edit_again" },
    ],
  ];
}

export function formatEditReviewMessage(
  change: HighlightedChange | null,
  proposed: MacroEstimate,
  channel: "telegram" | "line",
): string {
  const mealMacros = `P${Math.round(proposed.protein_g)} C${Math.round(proposed.carbs_g)} F${Math.round(proposed.fat_g)}`;
  const mealLine =
    channel === "telegram"
      ? `updated meal would be <b>${escapeHtml(proposed.description || "meal")}</b> — ~${Math.round(proposed.calories)} kcal (${mealMacros})`
      : `updated meal would be ${proposed.description || "meal"} — ~${Math.round(proposed.calories)} kcal (${mealMacros})`;

  if (change && change.name.trim()) {
    const itemMacros = `P${Math.round(change.protein_g)} C${Math.round(change.carbs_g)} F${Math.round(change.fat_g)}`;
    const itemLine =
      channel === "telegram"
        ? `ah i see — <b>${escapeHtml(change.name.trim())}</b> is ~${Math.round(change.calories)} kcal (${itemMacros}).`
        : `ah i see — ${change.name.trim()} is ~${Math.round(change.calories)} kcal (${itemMacros}).`;
    return `${itemLine}\n\n${mealLine}\n\nshould i adjust the meal accordingly?`;
  }

  return `ah i see — here's the updated estimate:\n\n${mealLine}\n\nshould i adjust the meal accordingly?`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function parseProposedMealEdit(raw: string | null | undefined): ProposedMealEdit | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProposedMealEdit;
    if (!parsed?.estimate || typeof parsed.estimate !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Prefer enriched item macros when the highlighted name matches an item. */
export function refineHighlightedChange(
  change: HighlightedChange | null,
  estimate: MacroEstimate,
): HighlightedChange | null {
  if (!change?.name.trim()) return change;
  const needle = change.name.trim().toLowerCase();
  const match = (estimate.items ?? []).find((item) => {
    const name = item.name.trim().toLowerCase();
    return name === needle || name.includes(needle) || needle.includes(name);
  });
  if (!match) return change;
  return {
    name: match.name,
    calories: match.calories,
    protein_g: match.protein_g,
    carbs_g: match.carbs_g,
    fat_g: match.fat_g,
  };
}
