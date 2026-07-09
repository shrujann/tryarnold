import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { insertPendingMeal } from "../db/pending-meals";
import { needsPortionConfirm } from "../schemas/nutrition";
import { estimateFromImage } from "../agents/vision";
import { stripEmoji } from "../services/text-style";
import { LineChannel } from "../channels/line";
import { TelegramChannel } from "../channels/telegram";
import { sendOut } from "./commands";

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
    let image;
    if (channel instanceof LineChannel && msg.photo.messageId) {
      image = await channel.downloadPhoto(msg.photo.messageId);
    } else {
      image = await channel.downloadPhoto(msg.photo.fileId);
    }

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
    if (channel instanceof LineChannel) {
      await channel.sendTextWithKeyboard(chatId, cleaned, buttons, msg.replyToken);
    } else if (channel instanceof TelegramChannel) {
      await channel.sendTextWithKeyboard(chatId, cleaned, buttons);
    } else {
      await channel.sendTextWithKeyboard(chatId, cleaned, buttons);
    }

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
