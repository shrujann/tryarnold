import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import { clearInteractiveKeyboard } from "../channels/interactive";
import type { UserRow } from "../db/users";
import {
  getPendingMeal,
  isPendingMealExpired,
  deletePendingMeal,
  pendingPhase,
  updatePendingMealIf,
  type PendingMealRow,
} from "../db/pending-meals";
import { macroEstimateFromDict } from "../schemas/nutrition";
import { applyMealEdit } from "../agents/meal-edit";
import { enrichEstimateWithFatSecret } from "../services/fatsecret";
import { sendMealConfirmUi } from "./clarification";
import { sendOut } from "./commands";

async function ensureEditingPhase(
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  pending: PendingMealRow,
): Promise<PendingMealRow | null> {
  const phase = pendingPhase(pending);
  if (phase === "editing") return pending;

  await clearInteractiveKeyboard(
    channel,
    msg.chatId,
    msg.callbackMessageId ?? pending.ui_message_id,
  );

  const moved = await updatePendingMealIf(db, user.id, pending.id, {
    phase: "editing",
  });
  if (!moved) return null;

  const refreshed = await getPendingMeal(db, user.id);
  if (!refreshed || refreshed.id !== pending.id) return null;
  return refreshed;
}

export async function handleMealEdit(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  pending: PendingMealRow,
): Promise<void> {
  const settings = getSettings(env);
  const instruction = (msg.text ?? "").trim();
  if (!instruction) {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "describe what you'd like to change.",
      msg.replyToken,
    );
    return;
  }

  if (isPendingMealExpired(pending, settings.pendingMealTtlMinutes)) {
    await deletePendingMeal(db, user.id);
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "that meal estimate expired. send the photo again.",
      msg.replyToken,
    );
    return;
  }

  if (!settings.aiEnabled) {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "can't edit meals right now. set OPENROUTER_API_KEY and try again.",
      msg.replyToken,
    );
    return;
  }

  const pendingId = pending.id;
  const editing = await ensureEditingPhase(db, channel, msg, user, pending);
  if (!editing) {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "that meal was replaced by a newer photo. send your change again if needed.",
      msg.replyToken,
    );
    return;
  }

  try {
    const current = macroEstimateFromDict(JSON.parse(editing.estimate_json));
    const edited = await applyMealEdit(env, current, instruction);
    const { estimate: enriched, fatsecretUsed } = await enrichEstimateWithFatSecret(
      edited,
      settings,
    );

    const saved = await updatePendingMealIf(db, user.id, pendingId, {
      estimate: enriched,
      phase: "confirm",
      fatsecretPrefetch: null,
      selectedToggleIds: [],
      exclusiveChoice: null,
    });

    if (!saved) {
      await sendOut(
        channel,
        db,
        msg.chatId,
        user.id,
        channel.name,
        "that meal was replaced by a newer photo. send your change again if needed.",
        msg.replyToken,
      );
      return;
    }

    const latest = await getPendingMeal(db, user.id);
    await sendMealConfirmUi(
      env,
      db,
      channel,
      msg.chatId,
      user,
      enriched,
      fatsecretUsed,
      msg.replyToken,
      latest?.ui_message_id,
    );
  } catch (err) {
    console.error("Meal edit failed", err);
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "couldn't apply that edit. try again with more detail.",
      msg.replyToken,
    );
  }
}
