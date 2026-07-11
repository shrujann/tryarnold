import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import type { PendingMealRow } from "../db/pending-meals";
import { updatePendingMeal } from "../db/pending-meals";
import { macroEstimateFromDict } from "../schemas/nutrition";
import { applyMealEdit } from "../agents/meal-edit";
import { enrichEstimateWithFatSecret } from "../services/fatsecret";
import { sendMealConfirmUi } from "./clarification";
import { sendOut } from "./commands";

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

  try {
    const current = macroEstimateFromDict(JSON.parse(pending.estimate_json));
    const edited = await applyMealEdit(env, current, instruction);
    const { estimate: enriched, fatsecretUsed } = await enrichEstimateWithFatSecret(
      edited,
      settings,
    );

    await updatePendingMeal(db, user.id, {
      estimate: enriched,
      phase: "confirm",
    });

    await sendMealConfirmUi(
      env,
      db,
      channel,
      msg.chatId,
      user,
      enriched,
      fatsecretUsed,
      msg.replyToken,
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
