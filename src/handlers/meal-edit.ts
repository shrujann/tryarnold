import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import {
  clearInteractiveKeyboard,
  sendInteractiveMessage,
} from "../channels/interactive";
import type { UserRow } from "../db/users";
import {
  getPendingMeal,
  isPendingMealExpired,
  deletePendingMeal,
  pendingPhase,
  updatePendingMealIf,
  type PendingMealRow,
} from "../db/pending-meals";
import { hasFatSecretAssumption, enrichEstimateWithFatSecret } from "../services/fatsecret";
import { macroEstimateFromDict } from "../schemas/nutrition";
import { applyMealEdit } from "../agents/meal-edit";
import {
  editReviewButtons,
  formatEditReviewMessage,
  parseProposedMealEdit,
  refineHighlightedChange,
  type EditReviewAction,
} from "../services/meal-edit-review";
import { stripEmoji } from "../services/text-style";
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
  if (phase === "editing" || phase === "reviewing_edit") return pending;

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

async function sendEditReviewUi(
  db: D1Database,
  channel: MessagingChannel,
  chatId: string | number,
  userId: number,
  message: string,
  replyToken?: string | null,
  uiMessageIdToEdit?: string | null,
): Promise<void> {
  const isTelegram = channel.name === "telegram";
  const messageId = await sendInteractiveMessage(
    channel,
    chatId,
    message,
    editReviewButtons(),
    replyToken,
    isTelegram
      ? {
          parseMode: "HTML",
          ...(uiMessageIdToEdit ? { editMessageId: uiMessageIdToEdit } : {}),
        }
      : undefined,
  );

  if (messageId != null) {
    const { updatePendingMeal } = await import("../db/pending-meals");
    await updatePendingMeal(db, userId, { uiMessageId: String(messageId) });
  }

  const { logMessage } = await import("../db/messages");
  await logMessage(db, userId, "out", stripEmoji(message), channel.name);
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
    // Always edit from the committed estimate, not a previous unconfirmed proposal.
    const current = macroEstimateFromDict(JSON.parse(editing.estimate_json));
    const { estimate: edited, highlighted_change } = await applyMealEdit(
      env,
      current,
      instruction,
    );
    const { estimate: enriched } = await enrichEstimateWithFatSecret(
      edited,
      settings,
    );
    const highlighted = refineHighlightedChange(highlighted_change, enriched);

    const saved = await updatePendingMealIf(db, user.id, pendingId, {
      phase: "reviewing_edit",
      proposedEdit: {
        estimate: enriched,
        highlighted_change: highlighted,
      },
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
    const channelFormat = channel.name === "telegram" ? "telegram" : "line";
    const reviewText = formatEditReviewMessage(
      highlighted,
      enriched,
      channelFormat,
    );

    await sendEditReviewUi(
      db,
      channel,
      msg.chatId,
      user.id,
      reviewText,
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

export async function handleEditReview(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  pending: PendingMealRow,
  action: EditReviewAction,
): Promise<void> {
  if (msg.callbackQueryId && channel.answerCallback) {
    await channel.answerCallback(msg.callbackQueryId);
  }

  if (pendingPhase(pending) !== "reviewing_edit") {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "nothing to confirm right now.",
      msg.replyToken,
    );
    return;
  }

  if (action === "edit_again") {
    await clearInteractiveKeyboard(
      channel,
      msg.chatId,
      msg.callbackMessageId ?? pending.ui_message_id,
    );
    await updatePendingMealIf(db, user.id, pending.id, {
      phase: "editing",
      proposedEdit: null,
    });
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "what would you like to change?",
      msg.replyToken,
    );
    return;
  }

  const proposed = parseProposedMealEdit(pending.proposed_estimate_json);
  if (!proposed) {
    await updatePendingMealIf(db, user.id, pending.id, {
      phase: "editing",
      proposedEdit: null,
    });
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "that edit proposal expired. tell me what to change again.",
      msg.replyToken,
    );
    return;
  }

  const fatsecretUsed = hasFatSecretAssumption(
    proposed.estimate.assumptions ?? [],
  );
  const saved = await updatePendingMealIf(db, user.id, pending.id, {
    estimate: proposed.estimate,
    phase: "confirm",
    proposedEdit: null,
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
    proposed.estimate,
    fatsecretUsed,
    msg.replyToken,
    latest?.ui_message_id,
  );
}
