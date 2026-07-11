import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import { displayText, hasPhoto, isCallback } from "../channels/types";
import { getOrCreateUser } from "../db/users";
import { logMessage } from "../db/messages";
import { getPendingMeal, pendingPhase } from "../db/pending-meals";
import { normalizeOnboardAction, hasStartedOnboarding, START_REQUIRED_PROMPT, LINE_FOLLOW_PROMPT } from "../services/onboarding";
import { normalizeActionWithSettings } from "../services/pending-meal";
import { parseClarifyCallback } from "../services/clarification";
import { runCoachAgent } from "../agents/coach";
import { handleCommand, sendOut } from "./commands";
import { handleOnboarding } from "./onboarding";
import { handlePhoto } from "./photo";
import { handleConfirmation } from "./confirmation";
import { handleClarification } from "./clarification";
import { handleMealEdit } from "./meal-edit";

function isOnboarded(user: { onboarded?: number | null }): boolean {
  return Number(user.onboarded) === 1;
}

export async function processMessage(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
): Promise<void> {
  const settings = getSettings(env);
  const user = await getOrCreateUser(db, msg);
  const userId = user.id;
  const chatId = msg.chatId;

  const kind = msg.isFollow
    ? "system"
    : hasPhoto(msg)
      ? "photo"
      : isCallback(msg)
        ? "system"
        : "text";
  await logMessage(
    db,
    userId,
    "in",
    msg.isFollow ? "follow" : displayText(msg),
    channel.name,
    kind,
  );

  if (msg.isFollow) {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      LINE_FOLLOW_PROMPT,
      msg.replyToken,
    );
    return;
  }

  const text = (msg.text ?? "").trim();

  if (!isCallback(msg) && text.startsWith("/")) {
    if (await handleCommand(channel, db, chatId, user, text, msg.replyToken)) {
      return;
    }
  }

  if (!isOnboarded(user)) {
    if (hasPhoto(msg)) {
      await sendOut(
        channel,
        db,
        chatId,
        userId,
        channel.name,
        hasStartedOnboarding(user)
          ? "finish setup first. tap through the prompts or use /setup to restart."
          : START_REQUIRED_PROMPT,
        msg.replyToken,
      );
      return;
    }

    if (!hasStartedOnboarding(user)) {
      if (isCallback(msg)) {
        if (msg.callbackQueryId && channel.answerCallback) {
          await channel.answerCallback(msg.callbackQueryId);
        }
        await sendOut(
          channel,
          db,
          chatId,
          userId,
          channel.name,
          START_REQUIRED_PROMPT,
          msg.replyToken,
        );
        return;
      }

      if (text && !text.startsWith("/")) {
        await sendOut(
          channel,
          db,
          chatId,
          userId,
          channel.name,
          START_REQUIRED_PROMPT,
          msg.replyToken,
        );
        return;
      }

      return;
    }

    const onboardCallback =
      isCallback(msg) && normalizeOnboardAction(msg.callbackData ?? "") !== null;
    if (onboardCallback || (!isCallback(msg) && text && !text.startsWith("/"))) {
      await handleOnboarding(env, db, channel, msg, user);
      return;
    }

    if (isCallback(msg)) {
      if (msg.callbackQueryId && channel.answerCallback) {
        await channel.answerCallback(msg.callbackQueryId);
      }
      return;
    }

    await handleOnboarding(env, db, channel, msg, user);
    return;
  }

  if (isCallback(msg)) {
    const clarifyAction = parseClarifyCallback(msg.callbackData ?? "");
    if (clarifyAction) {
      await handleClarification(env, db, channel, msg, user, clarifyAction);
      return;
    }
  }

  if (!isCallback(msg) && text && !text.startsWith("/")) {
    const pending = await getPendingMeal(db, userId);
    if (pending && pendingPhase(pending) === "editing") {
      await handleMealEdit(env, db, channel, msg, user, pending);
      return;
    }
  }

  const action = normalizeActionWithSettings(msg.callbackData ?? text, settings);
  if (action !== null) {
    const pending = await getPendingMeal(db, userId);
    if (isCallback(msg) || pending) {
      await handleConfirmation(env, db, channel, msg, user, action);
      return;
    }
  }

  if (isCallback(msg)) {
    if (msg.callbackQueryId && channel.answerCallback) {
      await channel.answerCallback(msg.callbackQueryId);
    }
    return;
  }

  if (hasPhoto(msg)) {
    await handlePhoto(env, db, channel, msg, user);
    return;
  }

  let reply: string;
  if (!settings.aiEnabled) {
    reply = "no ai key set right now so i can't chat fully yet. try /help.";
  } else {
    try {
      reply = await runCoachAgent(env, db, user, text);
    } catch (err) {
      console.error("Coach agent failed", err);
      reply = "couldn't generate a reply right now";
    }
    if (!reply) {
      reply = "couldn't generate a reply right now";
    }
  }

  await sendOut(channel, db, chatId, userId, channel.name, reply, msg.replyToken);
}

export async function processTelegramUpdate(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  update: unknown,
): Promise<void> {
  const msg = channel.parseUpdate(update);
  if (!msg || Array.isArray(msg)) return;
  await processMessage(env, db, channel, msg);
}

export async function processLineWebhook(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  update: unknown,
): Promise<void> {
  const messages = channel.parseUpdate(update);
  if (!messages || !Array.isArray(messages)) return;
  for (const msg of messages) {
    await processMessage(env, db, channel, msg);
  }
}
