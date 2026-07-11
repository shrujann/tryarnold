import type { Env } from "../env";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import { isCallback } from "../channels/types";
import type { UserRow } from "../db/users";
import {
  completeOnboarding,
  getProfileSummary,
  restartOnboarding,
  updateOnboardingStep,
} from "../db/users";
import {
  activityFromAction,
  genderFromAction,
  goalFromAction,
  isOnboardingStep,
  nextOnboardingStep,
  normalizeOnboardAction,
  stepButtons,
  stepPrompt,
  type OnboardingStep,
  unitFromAction,
} from "../services/onboarding";
import { parseHeight, parseWeight, type UnitPreference } from "../services/units";
import { stripEmoji } from "../services/text-style";
import {
  clearInteractiveKeyboard,
  sendInteractiveMessage,
} from "../channels/interactive";
import { sendOut } from "./commands";

function isOnboarded(user: UserRow): boolean {
  return Number(user.onboarded) === 1;
}

function currentStep(user: UserRow): OnboardingStep {
  const step = user.onboarding_step as string | null;
  if (isOnboardingStep(step)) return step;
  return "unit";
}

function unitPref(user: UserRow): UnitPreference {
  return user.unit_preference === "imperial" ? "imperial" : "metric";
}

async function sendStep(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  step: OnboardingStep,
  replyToken?: string | null,
): Promise<void> {
  const pref = unitPref(user);
  const prompt = stripEmoji(stepPrompt(step, pref));
  const buttons = stepButtons(step);

  if (buttons.length) {
    await sendInteractiveMessage(channel, chatId, prompt, buttons, replyToken);
    const { logMessage } = await import("../db/messages");
    await logMessage(db, user.id, "out", prompt, channel.name);
    return;
  }

  await sendOut(channel, db, chatId, user.id, channel.name, prompt, replyToken);
}

export async function presentOnboardingStep(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  replyToken?: string | null,
): Promise<void> {
  await sendStep(channel, db, chatId, user, currentStep(user), replyToken);
}

async function advanceAfterStep(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  completedStep: OnboardingStep,
  replyToken?: string | null,
): Promise<UserRow> {
  const next = nextOnboardingStep(completedStep);
  if (next === "done") {
    const updated = await completeOnboarding(db, user.id);
    const summary = getProfileSummary(updated);
    await sendOut(
      channel,
      db,
      chatId,
      user.id,
      channel.name,
      `setup complete.\n\n${summary}\n\nsend meals or food photos anytime. /progress for today's totals.`,
      replyToken,
    );
    return updated;
  }

  await updateOnboardingStep(db, user.id, { onboarding_step: next });
  const updated = { ...user, onboarding_step: next };
  await sendStep(channel, db, chatId, updated, next, replyToken);
  return updated;
}

async function handleButtonStep(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  action: ReturnType<typeof normalizeOnboardAction> & object,
  replyToken?: string | null,
  callbackMessageId?: number | null,
): Promise<void> {
  const step = currentStep(user);
  if (action.step !== step) {
    await sendOut(
      channel,
      db,
      chatId,
      user.id,
      channel.name,
      "that button doesn't match this step. continuing setup.",
      replyToken,
    );
    await presentOnboardingStep(channel, db, chatId, user, replyToken);
    return;
  }

  await clearInteractiveKeyboard(channel, chatId, callbackMessageId);

  switch (step) {
    case "unit": {
      const unit = unitFromAction(action.value);
      if (!unit) break;
      await updateOnboardingStep(db, user.id, {
        unit_preference: unit,
        onboarding_step: nextOnboardingStep("unit"),
      });
      await sendStep(channel, db, chatId, { ...user, unit_preference: unit }, "gender", replyToken);
      return;
    }
    case "gender": {
      const gender = genderFromAction(action.value);
      if (!gender) break;
      await updateOnboardingStep(db, user.id, {
        gender,
        onboarding_step: nextOnboardingStep("gender"),
      });
      await sendStep(channel, db, chatId, { ...user, gender }, "age", replyToken);
      return;
    }
    case "activity": {
      const activity = activityFromAction(action.value);
      if (!activity) break;
      await updateOnboardingStep(db, user.id, {
        activity_level: activity,
        onboarding_step: nextOnboardingStep("activity"),
      });
      await sendStep(
        channel,
        db,
        chatId,
        { ...user, activity_level: activity },
        "goal",
        replyToken,
      );
      return;
    }
    case "goal": {
      const goal = goalFromAction(action.value);
      if (!goal) break;
      await updateOnboardingStep(db, user.id, { fitness_goal: goal });
      await advanceAfterStep(channel, db, chatId, { ...user, fitness_goal: goal }, "goal", replyToken);
      return;
    }
    default:
      break;
  }

  await presentOnboardingStep(channel, db, chatId, user, replyToken);
}

async function handleTextStep(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  text: string,
  replyToken?: string | null,
): Promise<void> {
  const step = currentStep(user);
  const pref = unitPref(user);

  if (step === "age") {
    const age = parseInt(text, 10);
    if (!Number.isFinite(age) || age < 13 || age > 100) {
      await sendOut(
        channel,
        db,
        chatId,
        user.id,
        channel.name,
        "enter a valid age between 13 and 100.",
        replyToken,
      );
      return;
    }
    await updateOnboardingStep(db, user.id, {
      age,
      onboarding_step: nextOnboardingStep("age"),
    });
    await sendStep(channel, db, chatId, { ...user, age }, "weight", replyToken);
    return;
  }

  if (step === "weight") {
    const weightKg = parseWeight(text, pref);
    if (weightKg === null || weightKg < 30 || weightKg > 300) {
      await sendOut(
        channel,
        db,
        chatId,
        user.id,
        channel.name,
        pref === "imperial"
          ? "enter a valid weight like 165 lbs."
          : "enter a valid weight like 70 kg.",
        replyToken,
      );
      return;
    }
    await updateOnboardingStep(db, user.id, {
      weight_kg: weightKg,
      onboarding_step: nextOnboardingStep("weight"),
    });
    await sendStep(channel, db, chatId, { ...user, weight_kg: weightKg }, "height", replyToken);
    return;
  }

  if (step === "height") {
    const heightCm = parseHeight(text, pref);
    if (heightCm === null || heightCm < 120 || heightCm > 230) {
      await sendOut(
        channel,
        db,
        chatId,
        user.id,
        channel.name,
        pref === "imperial"
          ? "enter a valid height like 5'10 or 70 in."
          : "enter a valid height like 175 cm.",
        replyToken,
      );
      return;
    }
    await updateOnboardingStep(db, user.id, {
      height_cm: heightCm,
      onboarding_step: nextOnboardingStep("height"),
    });
    await sendStep(
      channel,
      db,
      chatId,
      { ...user, height_cm: heightCm },
      "activity",
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
    "use the buttons for this step, or reply with the requested number.",
    replyToken,
  );
  await presentOnboardingStep(channel, db, chatId, user, replyToken);
}

export async function handleOnboarding(
  _env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
): Promise<boolean> {
  if (isOnboarded(user)) return false;

  if (msg.callbackQueryId && channel.answerCallback) {
    await channel.answerCallback(msg.callbackQueryId);
  }

  if (isCallback(msg)) {
    const action = normalizeOnboardAction(msg.callbackData ?? "");
    if (action) {
      await handleButtonStep(
        channel,
        db,
        msg.chatId,
        user,
        action,
        msg.replyToken,
        msg.callbackMessageId,
      );
      return true;
    }
    return true;
  }

  const text = (msg.text ?? "").trim();
  if (text) {
    await handleTextStep(channel, db, msg.chatId, user, text, msg.replyToken);
    return true;
  }

  await presentOnboardingStep(channel, db, msg.chatId, user, msg.replyToken);
  return true;
}

export async function startOnboarding(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  replyToken?: string | null,
): Promise<void> {
  if (Number(user.onboarded) === 1) {
    await restartOnboarding(db, user.id);
  } else if (user.onboarding_step !== "unit") {
    await updateOnboardingStep(db, user.id, { onboarding_step: "unit" });
  }

  const resetUser = {
    ...user,
    onboarded: 0,
    onboarding_step: "unit",
  };
  await presentOnboardingStep(channel, db, chatId, resetUser, replyToken);
}
