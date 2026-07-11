import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import {
  deletePendingMeal,
  getPendingMeal,
  isPendingMealExpired,
} from "../db/pending-meals";
import { insertMeal } from "../db/meals";
import { updatePortionMultiplier } from "../db/users";
import { actionFactors } from "../services/pending-meal";
import { applyMultiplier, macroEstimateFromDict } from "../schemas/nutrition";
import {
  FATSECRET_ATTRIBUTION_LINE,
  FATSECRET_ATTRIBUTION_TELEGRAM,
  hasFatSecretAssumption,
} from "../services/fatsecret";
import { sendOut } from "./commands";

export async function handleConfirmation(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  action: string,
): Promise<void> {
  const settings = getSettings(env);

  if (msg.callbackQueryId && channel.answerCallback) {
    await channel.answerCallback(msg.callbackQueryId);
  }

  const userId = user.id;
  const chatId = msg.chatId;
  const pending = await getPendingMeal(db, userId);

  if (!pending) {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "nothing pending to confirm",
      msg.replyToken,
    );
    return;
  }

  if (isPendingMealExpired(pending, settings.pendingMealTtlMinutes)) {
    await deletePendingMeal(db, userId);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "that meal estimate expired. send the photo again.",
      msg.replyToken,
    );
    return;
  }

  const factors = actionFactors(settings);
  const factor = factors[action];

  if (factor === undefined) {
    await deletePendingMeal(db, userId);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "got it, skipped that one",
      msg.replyToken,
    );
    return;
  }

  if (factor === null) {
    await deletePendingMeal(db, userId);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "got it, skipped that one",
      msg.replyToken,
    );
    return;
  }

  const payload = JSON.parse(pending.estimate_json);
  let estimate = macroEstimateFromDict(payload);
  if (factor !== 1) {
    estimate = applyMultiplier(estimate, factor);
  }

  await insertMeal(db, {
    userId,
    source: "photo",
    estimate,
    mediaRef: pending.media_ref,
    mediaUniqueRef: pending.media_unique_ref,
    photoCaption: pending.photo_caption,
  });

  if (factor !== 1) {
    const alpha = 0.5;
    const current = Number(user.portion_multiplier ?? 1);
    const updated = Math.max(0.6, Math.min(1.4, current * factor ** alpha));
    await updatePortionMultiplier(db, userId, updated);
  }

  await deletePendingMeal(db, userId);

  const fatsecretUsed = hasFatSecretAssumption(estimate.assumptions);
  const isTelegram = channel.name === "telegram";
  let reply =
    `logged ${estimate.description || "meal"} - ${Math.round(estimate.calories)} kcal, ` +
    `P${Math.round(estimate.protein_g)}g C${Math.round(estimate.carbs_g)}g ` +
    `F${Math.round(estimate.fat_g)}g`;

  if (fatsecretUsed) {
    reply += isTelegram
      ? FATSECRET_ATTRIBUTION_TELEGRAM
      : FATSECRET_ATTRIBUTION_LINE;
  }

  if (fatsecretUsed && isTelegram) {
    await channel.sendText(chatId, reply, msg.replyToken, "HTML");
    const { logMessage } = await import("../db/messages");
    const logText =
      `logged ${estimate.description || "meal"} - ${Math.round(estimate.calories)} kcal, ` +
      `P${Math.round(estimate.protein_g)}g C${Math.round(estimate.carbs_g)}g ` +
      `F${Math.round(estimate.fat_g)}g` +
      "\n\nPowered by fatsecret Platform API — https://platform.fatsecret.com";
    const { stripEmoji } = await import("../services/text-style");
    await logMessage(db, userId, "out", stripEmoji(logText), channel.name);
    return;
  }

  await sendOut(channel, db, chatId, userId, channel.name, reply, msg.replyToken);
}
