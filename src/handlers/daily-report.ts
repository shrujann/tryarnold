import type { Env } from "../env";
import { getSettings } from "../config";
import type { MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { getDailyProgress } from "../db/users";
import { getMealsForDay, type MealRow } from "../db/meals";
import {
  formatMealReportCard,
  type MealFormatChannel,
} from "../services/meal-format";
import { resolveOutboundPhoto } from "../services/outbound-photo";
import {
  macroEstimateFromDict,
  type MacroEstimate,
} from "../schemas/nutrition";
import { sendOut } from "./commands";

const MAX_REPORT_MEALS = 12;

function estimateFromMealRow(meal: MealRow): MacroEstimate {
  let items: unknown[] = [];
  if (meal.items_json) {
    try {
      const parsed = JSON.parse(meal.items_json);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  return macroEstimateFromDict({
    description: meal.description || "meal",
    calories: Number(meal.calories) || 0,
    protein_g: Number(meal.protein_g) || 0,
    carbs_g: Number(meal.carbs_g) || 0,
    fat_g: Number(meal.fat_g) || 0,
    confidence: Number(meal.confidence) || 0.5,
    food_confidence: Number(meal.confidence) || 0.5,
    portion_confidence: 0.5,
    assumptions: [],
    items,
  });
}

function formatMealTime(ts: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || "UTC",
    }).format(new Date(ts.includes("T") ? ts : `${ts}Z`));
  } catch {
    return "";
  }
}

function formatReportHeader(
  progress: Awaited<ReturnType<typeof getDailyProgress>>,
): string {
  const totals =
    `today's report: ${Math.round(progress.calories)} kcal ` +
    `(P${Math.round(progress.protein_g)} C${Math.round(progress.carbs_g)} F${Math.round(progress.fat_g)})` +
    ` · ${progress.meals} meal${progress.meals === 1 ? "" : "s"}`;

  if (progress.target_calories == null) return totals;

  const remaining = progress.remaining_calories ?? 0;
  const absRemaining = Math.abs(Math.round(remaining));
  return `${totals}\n${absRemaining} kcal ${remaining >= 0 ? "left" : "over"} (target ${progress.target_calories})`;
}

async function sendMealCard(
  env: Env,
  channel: MessagingChannel,
  chatId: string | number,
  meal: MealRow,
  channelFormat: MealFormatChannel,
  timezone: string,
  replyToken?: string | null,
): Promise<void> {
  const settings = getSettings(env);
  const estimate = estimateFromMealRow(meal);
  const timeLabel = formatMealTime(meal.ts, timezone);
  const caption = formatMealReportCard(estimate, {
    channel: channelFormat,
    timeLabel: timeLabel || undefined,
  });
  const parseMode = channelFormat === "telegram" ? ("HTML" as const) : undefined;

  const photo = await resolveOutboundPhoto(
    channel.name,
    meal.media_ref,
    settings,
  );
  if (photo && channel.sendPhoto) {
    try {
      await channel.sendPhoto(chatId, {
        fileId: photo.fileId,
        imageUrl: photo.imageUrl,
        caption,
        parseMode,
        replyToken,
      });
      return;
    } catch (err) {
      console.error("Daily report photo send failed; falling back to text", err);
    }
  }

  if (channelFormat === "telegram") {
    await channel.sendText(chatId, caption, replyToken, "HTML");
  } else {
    await channel.sendText(chatId, caption, replyToken);
  }
}

export async function handleDailyReport(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  chatId: string | number,
  user: UserRow,
  replyToken?: string | null,
): Promise<void> {
  const progress = await getDailyProgress(db, user);
  const timezone = (user.timezone as string) || "UTC";
  const meals = await getMealsForDay(db, user.id, timezone);
  const channelFormat: MealFormatChannel =
    channel.name === "telegram" ? "telegram" : "line";

  if (!meals.length) {
    await sendOut(
      channel,
      db,
      chatId,
      user.id,
      channel.name,
      "no meals logged today yet. send a food photo to start.",
      replyToken,
    );
    return;
  }

  await sendOut(
    channel,
    db,
    chatId,
    user.id,
    channel.name,
    formatReportHeader(progress),
    replyToken,
  );

  const visible = meals.slice(0, MAX_REPORT_MEALS);
  for (const meal of visible) {
    // replyToken is single-use on LINE; only the header may consume it.
    await sendMealCard(
      env,
      channel,
      chatId,
      meal,
      channelFormat,
      timezone,
      null,
    );
  }

  if (meals.length > MAX_REPORT_MEALS) {
    const extra = meals.length - MAX_REPORT_MEALS;
    await sendOut(
      channel,
      db,
      chatId,
      user.id,
      channel.name,
      `showing first ${MAX_REPORT_MEALS} meals (${extra} more). totals above include everything.`,
      null,
    );
  }
}
