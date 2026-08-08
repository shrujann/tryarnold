import type { MacroEstimate, FoodItem } from "../schemas/nutrition";
import { isNegligibleItemName } from "./item-split";

export type MealFormatChannel = "telegram" | "line";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mealTitle(estimate: MacroEstimate): string {
  const desc = estimate.description?.trim();
  if (desc) return desc;
  const names = (estimate.items ?? []).slice(0, 3).map((i) => i.name);
  return names.length ? names.join(" + ") : "meal";
}

function macroSummary(estimate: MacroEstimate): string {
  return `P${Math.round(estimate.protein_g)} C${Math.round(estimate.carbs_g)} F${Math.round(estimate.fat_g)}`;
}

function isBreakdownItem(item: FoodItem): boolean {
  if (isNegligibleItemName(item.name)) return false;
  return (
    item.calories >= 5 ||
    (item.volume_ml != null && item.volume_ml > 0) ||
    item.weight_g > 0
  );
}

/** Items shown in the ingredient breakdown block. */
export function getDisplayableItems(items: FoodItem[]): FoodItem[] {
  const list = items ?? [];
  const displayable = list.filter(isBreakdownItem);

  if (displayable.length >= 2) return displayable;

  if (displayable.length === 1 && list.length === 1) return [];

  return [];
}

function formatItemAmount(item: FoodItem): string | null {
  if (item.volume_ml != null && item.volume_ml > 0) {
    return `${Math.round(item.volume_ml)} ml`;
  }
  if (item.weight_g > 0) {
    return `${Math.round(item.weight_g)} g`;
  }
  return null;
}

function formatBreakdownLines(
  items: FoodItem[],
  channel: MealFormatChannel,
): string {
  const lines = items.map((item) => {
    const label =
      channel === "telegram" ? escapeHtml(item.name) : item.name;
    const amount = formatItemAmount(item);
    const kcal = Math.round(item.calories);
    if (amount) {
      return `• ${label} — ${amount} (~${kcal} kcal)`;
    }
    return `• ${label} — ${kcal} kcal`;
  });
  return lines.join("\n");
}

function formatHeadline(
  estimate: MacroEstimate,
  channel: MealFormatChannel,
  caloriesLabel: string,
): string {
  const title = mealTitle(estimate);
  const macros = macroSummary(estimate);
  const cal = Math.round(estimate.calories);

  if (channel === "telegram") {
    return `<b>${escapeHtml(title)}</b> — ${caloriesLabel} ${cal} kcal (${macros})`;
  }
  return `${title} — ${caloriesLabel} ${cal} kcal (${macros})`;
}

export function formatMealConfirmMessage(
  estimate: MacroEstimate,
  opts: {
    remainingSuffix?: string;
    portionUnclear?: boolean;
    channel: MealFormatChannel;
  },
): string {
  const { remainingSuffix = "", portionUnclear = false, channel } = opts;
  const caloriesLabel = portionUnclear ? "around" : "~";
  const parts: string[] = [
    formatHeadline(estimate, channel, caloriesLabel),
  ];

  const breakdownItems = getDisplayableItems(estimate.items ?? []);
  if (breakdownItems.length >= 2) {
    parts.push("");
    parts.push(formatBreakdownLines(breakdownItems, channel));
  }

  parts.push("");
  if (portionUnclear) {
    parts.push(
      `portion's unclear. how big was it?${remainingSuffix}`,
    );
  } else {
    parts.push(`tap to log, edit, or skip.${remainingSuffix}`);
  }

  return parts.join("\n");
}

export function formatMealLoggedMessage(
  estimate: MacroEstimate,
  opts: { channel: MealFormatChannel },
): string {
  const { channel } = opts;
  const title = mealTitle(estimate);
  const cal = Math.round(estimate.calories);
  const macros = macroSummary(estimate);

  const headline =
    channel === "telegram"
      ? `logged <b>${escapeHtml(title)}</b> — ${cal} kcal (${macros})`
      : `logged ${title} — ${cal} kcal (${macros})`;

  const parts: string[] = [headline];
  const breakdownItems = getDisplayableItems(estimate.items ?? []);
  if (breakdownItems.length >= 2) {
    parts.push("");
    parts.push(formatBreakdownLines(breakdownItems, channel));
  }
  return parts.join("\n");
}

/** Plain-text version for message logs (no HTML). */
export function formatMealLoggedPlain(estimate: MacroEstimate): string {
  return formatMealLoggedMessage(estimate, { channel: "line" });
}

/** Caption for a meal row in /report (optional time prefix). */
export function formatMealReportCard(
  estimate: MacroEstimate,
  opts: { channel: MealFormatChannel; timeLabel?: string },
): string {
  const { channel, timeLabel } = opts;
  const title = mealTitle(estimate);
  const cal = Math.round(estimate.calories);
  const macros = macroSummary(estimate);
  const core =
    channel === "telegram"
      ? `<b>${escapeHtml(title)}</b> — ${cal} kcal (${macros})`
      : `${title} — ${cal} kcal (${macros})`;
  const headline = timeLabel
    ? `${channel === "telegram" ? escapeHtml(timeLabel) : timeLabel} · ${core}`
    : core;

  const parts: string[] = [headline];
  const breakdownItems = getDisplayableItems(estimate.items ?? []);
  if (breakdownItems.length >= 2) {
    parts.push("");
    parts.push(formatBreakdownLines(breakdownItems, channel));
  }
  return parts.join("\n");
}
