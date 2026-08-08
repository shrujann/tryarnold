import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import {
  deletePendingMeal,
  getPendingMeal,
  isPendingMealExpired,
  pendingPhase,
  updatePendingMeal,
} from "../db/pending-meals";
import { insertMeal } from "../db/meals";
import { updatePortionMultiplier } from "../db/users";
import { actionFactors } from "../services/pending-meal";
import { applyMultiplier, macroEstimateFromDict, type MacroEstimate } from "../schemas/nutrition";
import { formatMealLoggedMessage, formatMealLoggedPlain } from "../services/meal-format";
import { resolveOutboundPhoto } from "../services/outbound-photo";
import {
  FATSECRET_ATTRIBUTION_LINE,
  FATSECRET_ATTRIBUTION_TELEGRAM,
  hasFatSecretAssumption,
} from "../services/fatsecret";
import { sendOut } from "./commands";

function confirmMessageId(
  msg: InboundMessage,
  uiMessageId?: string | null,
): number | null {
  if (msg.callbackMessageId != null) return msg.callbackMessageId;
  if (uiMessageId) {
    const parsed = Number(uiMessageId);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatLoggedOutgoing(
  estimate: MacroEstimate,
  channelName: string,
  fatsecretUsed: boolean,
): string {
  const isTelegram = channelName === "telegram";
  const channelFormat = isTelegram ? "telegram" : "line";
  const base = formatMealLoggedMessage(estimate, { channel: channelFormat });
  if (!fatsecretUsed) return base;
  return (
    base +
    (isTelegram ? FATSECRET_ATTRIBUTION_TELEGRAM : FATSECRET_ATTRIBUTION_LINE)
  );
}

async function logOutgoingMessage(
  db: D1Database,
  userId: number,
  channelName: string,
  estimate: MacroEstimate,
  fatsecretUsed: boolean,
): Promise<void> {
  const { logMessage } = await import("../db/messages");
  const { stripEmoji } = await import("../services/text-style");
  const plain = stripEmoji(formatMealLoggedPlain(estimate));
  const logText =
    plain +
    (fatsecretUsed
      ? "\n\nPowered by fatsecret Platform API — https://platform.fatsecret.com"
      : "");
  await logMessage(db, userId, "out", logText, channelName);
}

async function deliverLoggedMeal(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  userId: number,
  estimate: MacroEstimate,
  mediaRef: string | null | undefined,
  messageId: number | null,
  fatsecretUsed: boolean,
): Promise<void> {
  const settings = getSettings(env);
  const isTelegram = channel.name === "telegram";
  const loggedText = formatLoggedOutgoing(estimate, channel.name, fatsecretUsed);
  const parseMode = isTelegram ? ("HTML" as const) : undefined;

  if (msg.callbackQueryId && channel.answerCallback) {
    await channel.answerCallback(msg.callbackQueryId);
  }

  const photo = await resolveOutboundPhoto(channel.name, mediaRef, settings);
  if (photo && channel.sendPhoto) {
    // Retire the confirm keyboard so Log/Edit/Skip don't linger.
    if (isTelegram && messageId) {
      if (channel.deleteMessage) {
        try {
          await channel.deleteMessage(msg.chatId, messageId);
        } catch {
          if (channel.clearMessageReplyMarkup) {
            await channel.clearMessageReplyMarkup(msg.chatId, messageId);
          }
        }
      } else if (channel.clearMessageReplyMarkup) {
        await channel.clearMessageReplyMarkup(msg.chatId, messageId);
      }
    }

    try {
      await channel.sendPhoto(msg.chatId, {
        fileId: photo.fileId,
        imageUrl: photo.imageUrl,
        caption: loggedText,
        parseMode,
        replyToken: msg.replyToken,
      });
      await logOutgoingMessage(db, userId, channel.name, estimate, fatsecretUsed);
      return;
    } catch (err) {
      console.error("Logged meal photo send failed; falling back to text", err);
      // Fall through to text delivery.
    }
  }

  if (isTelegram && messageId && channel.editMessageText) {
    try {
      await channel.editMessageText(msg.chatId, messageId, loggedText, "HTML");
      await logOutgoingMessage(db, userId, channel.name, estimate, fatsecretUsed);
      return;
    } catch {
      // Fall through to send a new message if edit fails (e.g. message too old).
    }
  }

  if (isTelegram) {
    await channel.sendText(msg.chatId, loggedText, msg.replyToken, "HTML");
    await logOutgoingMessage(db, userId, channel.name, estimate, fatsecretUsed);
    return;
  }

  await channel.sendText(msg.chatId, loggedText, msg.replyToken);
  await logOutgoingMessage(db, userId, channel.name, estimate, fatsecretUsed);
}

export async function handleConfirmation(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  action: string,
): Promise<void> {
  const settings = getSettings(env);

  const userId = user.id;
  const chatId = msg.chatId;
  const pending = await getPendingMeal(db, userId);

  if (!pending) {
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }
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
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }
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

  const messageId = confirmMessageId(msg, pending.ui_message_id);
  const isTelegram = channel.name === "telegram";

  if (action === "edit") {
    if (pendingPhase(pending) !== "confirm") {
      if (msg.callbackQueryId && channel.answerCallback) {
        await channel.answerCallback(msg.callbackQueryId);
      }
      await sendOut(
        channel,
        db,
        chatId,
        userId,
        channel.name,
        "finish the current step first.",
        msg.replyToken,
      );
      return;
    }

    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }

    if (isTelegram && messageId && channel.clearMessageReplyMarkup) {
      await channel.clearMessageReplyMarkup(chatId, messageId);
    }

    await updatePendingMeal(db, userId, { phase: "editing" });
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "what would you like to change?",
      msg.replyToken,
    );
    return;
  }

  const phase = pendingPhase(pending);
  if (phase !== "confirm") {
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "finish the current step first.",
      msg.replyToken,
    );
    return;
  }

  const factors = actionFactors(settings);
  const factor = factors[action];

  if (action === "skip" || factor === null) {
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId, { text: "skipped" });
    }

    if (isTelegram && messageId && channel.clearMessageReplyMarkup) {
      await channel.clearMessageReplyMarkup(chatId, messageId);
    }

    await deletePendingMeal(db, userId);
    return;
  }

  if (factor === undefined) {
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "unknown action",
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

  const fatsecretUsed = hasFatSecretAssumption(estimate.assumptions ?? []);
  await deliverLoggedMeal(
    env,
    db,
    channel,
    msg,
    userId,
    estimate,
    pending.media_ref,
    messageId,
    fatsecretUsed,
  );
}
