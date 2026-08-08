import type { Env } from "../env";
import { getSettings, type Settings } from "../config";
import type { MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { getDailyProgress } from "../db/users";
import { getMealsForDay, type MealRow } from "../db/meals";
import { startOfDayInTimezone } from "../db/client";
import {
  buildDailyReportPdf,
  formatMealTimeLabel,
  formatReportDateLabel,
  mealEstimateFromRow,
  type ReportMealImage,
} from "../services/daily-report-pdf";
import {
  buildReportDownloadUrl,
  type ReportTokenPayload,
} from "../services/report-token";
import { createLogger } from "../services/logger";
import { TelegramChannel } from "../channels/telegram";
import { LineChannel } from "../channels/line";
import { sendOut } from "./commands";

function reportCacheUrl(
  settings: Settings,
  userId: number,
  dayStart: string,
): string {
  return `${settings.publicBaseUrl.replace(/\/$/, "")}/reports/cache/${userId}/${encodeURIComponent(dayStart)}`;
}

async function loadMealImage(
  channel: MessagingChannel,
  meal: MealRow,
): Promise<ReportMealImage> {
  if (!meal.media_ref) return null;
  try {
    const image = await channel.downloadPhoto(meal.media_ref);
    return { bytes: image.bytes, mime: image.mime };
  } catch (err) {
    console.error("Failed to download meal photo for PDF", {
      mealId: meal.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function generateDailyReportPdfForUser(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  user: UserRow,
): Promise<{ bytes: Uint8Array; filename: string; mealCount: number }> {
  const timezone = (user.timezone as string) || "UTC";
  const progress = await getDailyProgress(db, user);
  const meals = await getMealsForDay(db, user.id, timezone);
  const dateLabel = formatReportDateLabel(timezone);

  const entries = [];
  for (const meal of meals) {
    entries.push({
      meal,
      estimate: mealEstimateFromRow(meal),
      timeLabel: formatMealTimeLabel(meal.ts, timezone),
      image: await loadMealImage(channel, meal),
    });
  }

  const bytes = await buildDailyReportPdf({
    dateLabel,
    timezone,
    progress,
    meals: entries,
  });

  const safeDate = dateLabel.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return {
    bytes,
    filename: `arnold-daily-report-${safeDate}.pdf`,
    mealCount: meals.length,
  };
}

export async function handleDailyReport(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  chatId: string | number,
  user: UserRow,
  replyToken?: string | null,
): Promise<void> {
  const settings = getSettings(env);
  const logger = createLogger(settings.logLevel);
  const timezone = (user.timezone as string) || "UTC";
  const meals = await getMealsForDay(db, user.id, timezone);

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
    "building your daily report…",
    replyToken,
  );

  try {
    const { bytes, filename, mealCount } = await generateDailyReportPdfForUser(
      env,
      db,
      channel,
      user,
    );

    logger.info({
      stage: "daily_report_pdf",
      userId: user.id,
      meals: mealCount,
      bytes: bytes.byteLength,
      channel: channel.name,
    });

    if (!channel.sendDocument) {
      await sendOut(
        channel,
        db,
        chatId,
        user.id,
        channel.name,
        "couldn't send the PDF on this channel yet.",
        null,
      );
      return;
    }

    const caption = `your daily report · ${mealCount} meal${mealCount === 1 ? "" : "s"}`;

    if (channel.name === "telegram") {
      await channel.sendDocument(chatId, {
        bytes,
        filename,
        mimeType: "application/pdf",
        caption,
        replyToken: null,
      });
      return;
    }

    const dayStart = startOfDayInTimezone(timezone);
    const cacheUrl = reportCacheUrl(settings, user.id, dayStart);
    await caches.default.put(
      cacheUrl,
      new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `inline; filename="${filename}"`,
          "cache-control": "private, max-age=3600",
        },
      }),
    );

    const fileUrl = await buildReportDownloadUrl(settings, {
      userId: user.id,
      channel: channel.name,
      dayStart,
    });

    await channel.sendDocument(chatId, {
      bytes,
      fileUrl,
      filename,
      mimeType: "application/pdf",
      caption,
      replyToken: null,
    });
  } catch (err) {
    console.error("Daily report PDF failed", err);
    await sendOut(
      channel,
      db,
      chatId,
      user.id,
      channel.name,
      "couldn't build your PDF report right now. try again in a moment.",
      null,
    );
  }
}

/** Serve a previously cached (or regenerated) daily report PDF. */
export async function serveDailyReportPdf(
  env: Env,
  tokenPayload: ReportTokenPayload,
): Promise<Response> {
  const settings = getSettings(env);
  const cacheUrl = reportCacheUrl(
    settings,
    tokenPayload.userId,
    tokenPayload.dayStart,
  );
  const cached = await caches.default.match(cacheUrl);
  if (cached) return cached;

  const userRow = await env.DB.prepare(
    "SELECT * FROM users WHERE id = ? LIMIT 1",
  )
    .bind(tokenPayload.userId)
    .first();
  if (!userRow) {
    return new Response("not found", { status: 404 });
  }

  const user = userRow as unknown as UserRow;
  const channel =
    tokenPayload.channel === "line"
      ? new LineChannel(settings)
      : new TelegramChannel(settings);

  const { bytes, filename } = await generateDailyReportPdfForUser(
    env,
    env.DB,
    channel,
    user,
  );

  const response = new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, max-age=3600",
    },
  });
  await caches.default.put(cacheUrl, response.clone());
  return response;
}
