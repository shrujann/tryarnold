import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import { clearInteractiveKeyboard, sendInteractiveMessage } from "../channels/interactive";
import type { UserRow } from "../db/users";
import { getDailyProgress } from "../db/users";
import {
  deletePendingMeal,
  getPendingMeal,
  insertPendingMeal,
  isPendingMealExpired,
  parseClarifyPlan,
  parseSelectedToggleIds,
  pendingPhase,
  updatePendingMeal,
  type PendingMealRow,
} from "../db/pending-meals";
import { applyMultiplier, macroEstimateFromDict } from "../schemas/nutrition";
import {
  assembleMealFromPrefetchCache,
  fetchClarifyNutritionCache,
  parseFatSecretPrefetch,
  FATSECRET_ATTRIBUTION_LINE,
  FATSECRET_ATTRIBUTION_TELEGRAM,
} from "../services/fatsecret";
import {
  buildClarifyPlan,
  buildExclusiveKeyboard,
  buildToggleKeyboard,
  clearToggles,
  formatExclusiveMessage,
  formatToggleMessage,
  mergeClarifyIntoDraft,
  toggleSelection,
  type ClarifyCallbackAction,
  type ClarifyPlan,
} from "../services/clarification";
import { formatMealConfirmMessage } from "../services/meal-format";
import { createLogger } from "../services/logger";
import { stripEmoji } from "../services/text-style";
import { sendOut } from "./commands";

export { parseClarifyCallback, isClarifyCallback } from "../services/clarification";

const ANALYZING_IMAGE_TEXT = "Analyzing image…";

function scaledVisionDraft(draft: Parameters<typeof mergeClarifyIntoDraft>[0], multiplier: number) {
  if (multiplier === 1) return draft;
  return applyMultiplier(draft, multiplier);
}

async function beginPhotoAnalysisStatus(
  channel: MessagingChannel,
  chatId: string | number,
  replyToken?: string | null,
): Promise<{ telegramMessageId?: number }> {
  if (channel.name === "line") {
    await channel.sendText(chatId, ANALYZING_IMAGE_TEXT, replyToken);
    return {};
  }
  if (channel.sendTextReturningId) {
    const messageId = await channel.sendTextReturningId(chatId, ANALYZING_IMAGE_TEXT);
    return messageId != null ? { telegramMessageId: messageId } : {};
  }
  await channel.sendText(chatId, ANALYZING_IMAGE_TEXT);
  return {};
}

async function endPhotoAnalysisStatus(
  channel: MessagingChannel,
  chatId: string | number,
  telegramMessageId?: number,
): Promise<void> {
  if (
    channel.name === "telegram" &&
    telegramMessageId != null &&
    channel.deleteMessage
  ) {
    await channel.deleteMessage(chatId, telegramMessageId);
  }
}

async function fetchAndStoreNutritionCache(
  env: Env,
  db: D1Database,
  userId: number,
  draft: Parameters<typeof mergeClarifyIntoDraft>[0],
  plan: ClarifyPlan,
  baseMultiplier: number,
): Promise<void> {
  const settings = getSettings(env);
  if (!settings.fatsecretEnabled) return;

  const scaledDraft = scaledVisionDraft(draft, baseMultiplier);
  const cache = await fetchClarifyNutritionCache(scaledDraft, plan, settings);
  await updatePendingMeal(db, userId, { fatsecretPrefetch: cache });
}

function confirmButtons(): Array<Array<{ label: string; data: string }>> {
  return [
    [
      { label: "Log", data: "meal:log" },
      { label: "Edit", data: "meal:edit" },
      { label: "Skip", data: "meal:skip" },
    ],
  ];
}

async function remainingSuffixForUser(
  db: D1Database,
  user: UserRow,
  calories: number,
): Promise<string> {
  if (Number(user.onboarded) !== 1) return "";
  const progress = await getDailyProgress(db, user);
  if (progress.remaining_calories == null) return "";
  const left = Math.round(progress.remaining_calories - calories);
  return ` (${left} kcal left after this)`;
}

async function buildMealConfirmOutgoing(
  db: D1Database,
  user: UserRow,
  estimate: Parameters<typeof formatMealConfirmMessage>[0],
  fatsecretUsed: boolean,
  channelName: string,
): Promise<string> {
  const remainingSuffix = await remainingSuffixForUser(db, user, estimate.calories);
  const isTelegram = channelName === "telegram";
  const channelFormat = isTelegram ? "telegram" : "line";
  const prompt = formatMealConfirmMessage(estimate, {
    remainingSuffix,
    portionUnclear: false,
    channel: channelFormat,
  });
  const cleaned = stripEmoji(prompt);
  return (
    cleaned +
    (fatsecretUsed
      ? isTelegram
        ? FATSECRET_ATTRIBUTION_TELEGRAM
        : FATSECRET_ATTRIBUTION_LINE
      : "")
  );
}

export async function sendMealConfirmUi(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  chatId: string | number,
  user: UserRow,
  estimate: Parameters<typeof formatMealConfirmMessage>[0],
  fatsecretUsed: boolean,
  replyToken?: string | null,
  uiMessageIdToEdit?: string | null,
): Promise<void> {
  const isTelegram = channel.name === "telegram";
  const outgoing = await buildMealConfirmOutgoing(
    db,
    user,
    estimate,
    fatsecretUsed,
    channel.name,
  );

  const messageId = await sendInteractiveMessage(
    channel,
    chatId,
    outgoing,
    confirmButtons(),
    replyToken,
    isTelegram
      ? {
          parseMode: "HTML",
          ...(uiMessageIdToEdit ? { editMessageId: uiMessageIdToEdit } : {}),
        }
      : undefined,
  );

  if (messageId != null) {
    await updatePendingMeal(db, user.id, { uiMessageId: String(messageId) });
  }

  const { logMessage } = await import("../db/messages");
  const logText =
    stripEmoji(
      formatMealConfirmMessage(estimate, {
        remainingSuffix: await remainingSuffixForUser(db, user, estimate.calories),
        portionUnclear: false,
        channel: "line",
      }),
    ) +
    (fatsecretUsed
      ? "\n\nPowered by fatsecret Platform API — https://platform.fatsecret.com"
      : "");
  await logMessage(db, user.id, "out", logText, channel.name);
}

export async function finalizePendingMeal(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  chatId: string | number,
  user: UserRow,
  pending: PendingMealRow,
  replyToken?: string | null,
): Promise<void> {
  const settings = getSettings(env);
  const logger = createLogger(settings.logLevel);

  const draft = macroEstimateFromDict(JSON.parse(pending.estimate_json));
  const selectedIds = parseSelectedToggleIds(pending);
  const exclusiveChoice = pending.clarify_exclusive_choice ?? null;
  const multiplier = Number(pending.base_multiplier ?? 1);

  let merged = mergeClarifyIntoDraft(draft, selectedIds, exclusiveChoice);
  if (multiplier !== 1) {
    merged = applyMultiplier(merged, multiplier);
  }

  const scaledDraft = scaledVisionDraft(draft, multiplier);
  const cache = parseFatSecretPrefetch(pending);

  let enriched: Parameters<typeof sendMealConfirmUi>[5];
  let fatsecretUsed: boolean;

  if (cache) {
    ({ estimate: enriched, fatsecretUsed } = assembleMealFromPrefetchCache(
      scaledDraft,
      selectedIds,
      exclusiveChoice,
      cache,
    ));
  } else {
    enriched = merged;
    fatsecretUsed = false;
    if (settings.fatsecretEnabled) {
      logger.warn({
        stage: "clarify_finalize",
        userId: user.id,
        message: "nutrition cache missing; using vision estimate",
      });
    }
  }

  logger.info({
    stage: "clarify_enriched",
    userId: user.id,
    fatsecretUsed,
    calories: enriched.calories,
    toggles: selectedIds,
    exclusive: exclusiveChoice,
  });

  await updatePendingMeal(db, user.id, {
    estimate: enriched,
    phase: "confirm",
  });

  await sendMealConfirmUi(
    env,
    db,
    channel,
    chatId,
    user,
    enriched,
    fatsecretUsed,
    replyToken,
    pending.ui_message_id,
  );
}

async function sendToggleUi(
  channel: MessagingChannel,
  chatId: string | number,
  plan: ClarifyPlan,
  selectedIds: string[],
  replyToken?: string | null,
  uiMessageId?: string | null,
): Promise<string | null> {
  const text = formatToggleMessage(plan);
  const keyboard = buildToggleKeyboard(plan, selectedIds);

  const messageId = await sendInteractiveMessage(
    channel,
    chatId,
    text,
    keyboard,
    replyToken,
    channel.name === "telegram" && uiMessageId
      ? { editMessageId: uiMessageId, editMarkupOnly: true }
      : undefined,
  );
  return messageId != null ? String(messageId) : null;
}

async function sendExclusiveUi(
  channel: MessagingChannel,
  chatId: string | number,
  plan: ClarifyPlan,
  replyToken?: string | null,
): Promise<void> {
  if (!plan.exclusive) return;
  const text = formatExclusiveMessage(plan.exclusive);
  const keyboard = buildExclusiveKeyboard(plan.exclusive);
  await sendInteractiveMessage(channel, chatId, text, keyboard, replyToken);
}

export async function startClarifyFlowFromVision(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  draft: Parameters<typeof buildClarifyPlan>[0],
  clarification: Parameters<typeof buildClarifyPlan>[1],
  baseMultiplier: number,
): Promise<void> {
  const plan = buildClarifyPlan(draft, clarification);
  const chatId = msg.chatId;
  const lineReplyToken = channel.name === "line" ? msg.replyToken : null;

  if (plan.toggles.length > 0) {
    await insertPendingMeal(db, {
      userId: user.id,
      estimate: draft,
      baseMultiplier,
      mediaRef: msg.photo?.fileId,
      mediaUniqueRef: msg.photo?.fileUniqueId,
      photoCaption: msg.caption,
      phase: "clarifying_toggle",
      clarifyPlan: plan,
      selectedToggleIds: [],
    });

    const analyzing = await beginPhotoAnalysisStatus(channel, chatId, lineReplyToken);
    await fetchAndStoreNutritionCache(env, db, user.id, draft, plan, baseMultiplier);
    await endPhotoAnalysisStatus(channel, chatId, analyzing.telegramMessageId);

    const messageId = await sendToggleUi(channel, chatId, plan, [], null);
    if (messageId) {
      await updatePendingMeal(db, user.id, { uiMessageId: messageId });
    }
    return;
  }

  if (plan.exclusive) {
    await insertPendingMeal(db, {
      userId: user.id,
      estimate: draft,
      baseMultiplier,
      mediaRef: msg.photo?.fileId,
      mediaUniqueRef: msg.photo?.fileUniqueId,
      photoCaption: msg.caption,
      phase: "clarifying_exclusive",
      clarifyPlan: plan,
    });

    const analyzing = await beginPhotoAnalysisStatus(channel, chatId, lineReplyToken);
    await fetchAndStoreNutritionCache(env, db, user.id, draft, plan, baseMultiplier);
    await endPhotoAnalysisStatus(channel, chatId, analyzing.telegramMessageId);

    await sendExclusiveUi(channel, chatId, plan, null);
    return;
  }

  await insertPendingMeal(db, {
    userId: user.id,
    estimate: draft,
    baseMultiplier,
    mediaRef: msg.photo?.fileId,
    mediaUniqueRef: msg.photo?.fileUniqueId,
    photoCaption: msg.caption,
    phase: "confirm",
  });

  const analyzing = await beginPhotoAnalysisStatus(channel, chatId, lineReplyToken);
  await fetchAndStoreNutritionCache(env, db, user.id, draft, plan, baseMultiplier);
  await endPhotoAnalysisStatus(channel, chatId, analyzing.telegramMessageId);

  const pending = await getPendingMeal(db, user.id);
  if (pending) {
    await finalizePendingMeal(
      env,
      db,
      channel,
      chatId,
      user,
      pending,
      null,
    );
  }
}

async function goToExclusiveOrFinalize(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  pending: PendingMealRow,
): Promise<void> {
  const plan = parseClarifyPlan(pending);
  if (plan?.exclusive) {
    await updatePendingMeal(db, user.id, {
      phase: "clarifying_exclusive",
      selectedToggleIds: parseSelectedToggleIds(pending),
    });
    await sendExclusiveUi(channel, msg.chatId, plan, msg.replyToken);
    return;
  }

  const refreshed = await getPendingMeal(db, user.id);
  if (refreshed) {
    await finalizePendingMeal(
      env,
      db,
      channel,
      msg.chatId,
      user,
      refreshed,
      msg.replyToken,
    );
  }
}

export async function handleClarification(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  action: ClarifyCallbackAction,
): Promise<void> {
  const settings = getSettings(env);

  if (msg.callbackQueryId && channel.answerCallback) {
    await channel.answerCallback(msg.callbackQueryId);
  }

  const pending = await getPendingMeal(db, user.id);
  if (!pending) {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "nothing pending to clarify",
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

  const phase = pendingPhase(pending);
  const plan = parseClarifyPlan(pending);

  if (action.type === "toggle" && phase === "clarifying_toggle" && plan) {
    const selectedIds = toggleSelection(parseSelectedToggleIds(pending), action.id);
    await updatePendingMeal(db, user.id, { selectedToggleIds: selectedIds });

    const uiMessageId =
      msg.callbackMessageId != null
        ? String(msg.callbackMessageId)
        : pending.ui_message_id;

    const storedMessageId = await sendToggleUi(
      channel,
      msg.chatId,
      plan,
      selectedIds,
      msg.replyToken,
      uiMessageId,
    );

    if (storedMessageId && !pending.ui_message_id) {
      await updatePendingMeal(db, user.id, { uiMessageId: storedMessageId });
    }
    return;
  }

  if (action.type === "clarify_none" && phase === "clarifying_toggle") {
    await clearInteractiveKeyboard(
      channel,
      msg.chatId,
      msg.callbackMessageId ?? pending.ui_message_id,
    );
    await updatePendingMeal(db, user.id, {
      selectedToggleIds: clearToggles(),
    });
    const refreshed = (await getPendingMeal(db, user.id))!;
    await goToExclusiveOrFinalize(env, db, channel, msg, user, refreshed);
    return;
  }

  if (action.type === "clarify_done" && phase === "clarifying_toggle") {
    await clearInteractiveKeyboard(
      channel,
      msg.chatId,
      msg.callbackMessageId ?? pending.ui_message_id,
    );
    const calcMessageId = msg.callbackMessageId ?? pending.ui_message_id;
    if (
      channel.name === "telegram" &&
      calcMessageId != null &&
      channel.editMessageText
    ) {
      try {
        await channel.editMessageText(
          msg.chatId,
          calcMessageId,
          "calculating nutrition…",
        );
      } catch {
        // Non-fatal; confirm will replace this message when ready.
      }
    }
    await goToExclusiveOrFinalize(env, db, channel, msg, user, pending);
    return;
  }

  if (
    action.type === "exclusive" &&
    phase === "clarifying_exclusive"
  ) {
    await clearInteractiveKeyboard(
      channel,
      msg.chatId,
      msg.callbackMessageId ?? pending.ui_message_id,
    );
    await updatePendingMeal(db, user.id, {
      exclusiveChoice: action.id,
    });
    const refreshed = (await getPendingMeal(db, user.id))!;
    await finalizePendingMeal(
      env,
      db,
      channel,
      msg.chatId,
      user,
      refreshed,
      msg.replyToken,
    );
    return;
  }

  if (action.type === "exclusive_none" && phase === "clarifying_exclusive") {
    await clearInteractiveKeyboard(
      channel,
      msg.chatId,
      msg.callbackMessageId ?? pending.ui_message_id,
    );
    await updatePendingMeal(db, user.id, { exclusiveChoice: null });
    const refreshed = (await getPendingMeal(db, user.id))!;
    await finalizePendingMeal(
      env,
      db,
      channel,
      msg.chatId,
      user,
      refreshed,
      msg.replyToken,
    );
    return;
  }

  await sendOut(
    channel,
    db,
    msg.chatId,
    user.id,
    channel.name,
    "finish the current step first.",
    msg.replyToken,
  );
}
