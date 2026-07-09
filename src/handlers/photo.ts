import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { insertPendingMeal } from "../db/pending-meals";
import { needsPortionConfirm } from "../schemas/nutrition";
import { estimateFromImage } from "../agents/vision";
import { stripEmoji } from "../services/text-style";
import { sendOut } from "./commands";

function debugLog(message: string, hypothesisId: string, data: Record<string, unknown>): void {
  // #region agent log
  console.error(
    "LINE_PHOTO_DEBUG",
    JSON.stringify({
      sessionId: "ae6431",
      runId: "pre-fix-console",
      hypothesisId,
      location: "src/handlers/photo.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  );
  fetch("http://127.0.0.1:7685/ingest/9e085500-f454-4050-a819-bbbb69fc0e17", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "ae6431",
    },
    body: JSON.stringify({
      sessionId: "ae6431",
      runId: "pre-fix",
      hypothesisId,
      location: "src/handlers/photo.ts",
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

export async function handlePhoto(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
): Promise<void> {
  const settings = getSettings(env);
  const userId = user.id;
  const chatId = msg.chatId;

  if (!settings.aiEnabled) {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "can't read photos right now. set OPENROUTER_API_KEY and try again.",
      msg.replyToken,
    );
    return;
  }

  if (!msg.photo) return;

  try {
    const image = await channel.downloadPhoto(msg.photo.fileId);
    debugLog("photo downloaded", "H3", {
      mime: image.mime,
      bytesLength: image.bytes.byteLength,
      hasCaption: Boolean(msg.caption),
      channel: channel.name,
    });

    let estimate = await estimateFromImage(
      env,
      image.bytes,
      image.mime,
      msg.caption,
    );

    const multiplier = Number(user.portion_multiplier ?? 1);
    if (multiplier !== 1) {
      const { applyMultiplier } = await import("../schemas/nutrition");
      estimate = applyMultiplier(estimate, multiplier);
    }

    if (estimate.calories > settings.mealConfirmMaxCalories) {
      estimate = {
        ...estimate,
        portion_confidence: Math.min(estimate.portion_confidence || 0.5, 0.3),
      };
    }

    await insertPendingMeal(db, {
      userId,
      estimate,
      baseMultiplier: multiplier,
      mediaRef: msg.photo.fileId,
      mediaUniqueRef: msg.photo.fileUniqueId,
      photoCaption: msg.caption,
    });
    debugLog("final estimate before prompt", "H4", {
      description: estimate.description,
      calories: estimate.calories,
      protein_g: estimate.protein_g,
      carbs_g: estimate.carbs_g,
      fat_g: estimate.fat_g,
      portion_confidence: estimate.portion_confidence,
      food_confidence: estimate.food_confidence,
      itemCount: estimate.items.length,
      itemsPreview: estimate.items.slice(0, 3).map((item) => ({
        name: item.name,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
      })),
      appliedMultiplier: multiplier,
    });

    const names = (estimate.items ?? []).slice(0, 3).map((i) => i.name);
    const summary = names.length ? names.join(" + ") : estimate.description || "meal";
    const macros = `P${Math.round(estimate.protein_g)} C${Math.round(estimate.carbs_g)} F${Math.round(estimate.fat_g)}`;

    let prompt: string;
    let buttons: Array<Array<{ label: string; data: string }>>;

    if (needsPortionConfirm(estimate, settings.portionConfidenceThreshold)) {
      prompt = `${summary} - around ${Math.round(estimate.calories)} kcal (${macros}), but portion's unclear. how big was it?`;
      buttons = [
        [
          { label: "Small", data: "meal:size_s" },
          { label: "Medium", data: "meal:size_m" },
          { label: "Large", data: "meal:size_l" },
        ],
        [{ label: "Skip", data: "meal:skip" }],
      ];
    } else {
      prompt = `${summary} - ~${Math.round(estimate.calories)} kcal (${macros}). tap to log or adjust.`;
      buttons = [
        [
          { label: "Log", data: "meal:log" },
          { label: "Smaller", data: "meal:smaller" },
          { label: "Bigger", data: "meal:bigger" },
        ],
        [{ label: "Skip", data: "meal:skip" }],
      ];
    }

    const cleaned = stripEmoji(prompt);
    await channel.sendTextWithKeyboard(chatId, cleaned, buttons, msg.replyToken);

    const { logMessage } = await import("../db/messages");
    await logMessage(db, userId, "out", cleaned, channel.name);
  } catch (err) {
    console.error("Photo processing failed", err);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "couldn't read that photo. tell me roughly what it was.",
      msg.replyToken,
    );
  }
}
