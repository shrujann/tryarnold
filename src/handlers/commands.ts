import type { MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { getDailyProgress, updateOnboardingStep } from "../db/users";
import { deleteLastMeal, getLastMeal } from "../db/meals";
import { hasStartedOnboarding } from "../services/onboarding";
import { stripEmoji } from "../services/text-style";
import { presentOnboardingStep, startOnboarding } from "./onboarding";

export const HELP =
  "how this works:\n" +
  "- /start - set up or resume your calorie targets\n" +
  "- text me what you ate or send a food photo\n" +
  "- send a barcode photo, type the digits, or /barcode 8881234567890\n" +
  "- /progress - today's summary vs your targets\n" +
  "- /undo - remove your last logged meal\n" +
  "- /setup - redo calorie and macro setup\n" +
  "- /last-analysis - last logged meal\n" +
  "- /help - this message\n\n" +
  "note: proactive check-ins and pdf reports are not on this worker.";

export const WELCOME =
  "hey, i'm your fitness coach. text meals or send food pics and i'll track " +
  "them.\n\nuse /progress for today's totals or /setup to change your targets.";

function isOnboarded(user: UserRow): boolean {
  return Number(user.onboarded) === 1;
}

async function sendOut(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  userId: number,
  channelName: string,
  text: string,
  replyToken?: string | null,
): Promise<void> {
  const cleaned = stripEmoji(text);
  await channel.sendText(chatId, cleaned, replyToken);
  const { logMessage } = await import("../db/messages");
  await logMessage(db, userId, "out", cleaned, channelName);
}

function formatProgress(user: UserRow, progress: Awaited<ReturnType<typeof getDailyProgress>>): string {
  const totals =
    `today: ${Math.round(progress.calories)} kcal ` +
    `(P${Math.round(progress.protein_g)} C${Math.round(progress.carbs_g)} F${Math.round(progress.fat_g)})` +
    ` · ${progress.meals} meal${progress.meals === 1 ? "" : "s"}`;

  if (progress.target_calories == null) return totals;

  const remaining = progress.remaining_calories ?? 0;
  const sign = remaining >= 0 ? "" : "+";
  const absRemaining = Math.abs(Math.round(remaining));

  return `${totals}\n${sign}${absRemaining} kcal ${remaining >= 0 ? "left" : "over"} (target ${progress.target_calories})`;
}

export async function handleCommand(
  channel: MessagingChannel,
  db: D1Database,
  chatId: string | number,
  user: UserRow,
  text: string,
  replyToken?: string | null,
): Promise<boolean> {
  const cmd = text.split(/\s+/)[0]!.toLowerCase().replace(/^\//, "").split("@")[0]!;
  const userId = user.id;

  if (cmd === "start") {
    if (!isOnboarded(user)) {
      let activeUser = user;
      if (!hasStartedOnboarding(user)) {
        await updateOnboardingStep(db, userId, { onboarding_step: "unit" });
        activeUser = { ...user, onboarding_step: "unit" };
      }
      await presentOnboardingStep(channel, db, chatId, activeUser, replyToken);
    } else {
      await sendOut(channel, db, chatId, userId, channel.name, WELCOME, replyToken);
    }
    return true;
  }

  if (cmd === "setup") {
    await startOnboarding(channel, db, chatId, user, replyToken);
    return true;
  }

  if (cmd === "help") {
    await sendOut(channel, db, chatId, userId, channel.name, HELP, replyToken);
    return true;
  }

  if (cmd === "progress") {
    const progress = await getDailyProgress(db, user);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      formatProgress(user, progress),
      replyToken,
    );
    return true;
  }

  if (cmd === "undo") {
    const removed = await deleteLastMeal(db, userId);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      removed ? `removed ${removed}` : "nothing to remove",
      replyToken,
    );
    return true;
  }

  if (["report", "week", "pause", "resume", "nudge-test", "test-nudge"].includes(cmd)) {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "that feature isn't on this cloudflare worker yet",
      replyToken,
    );
    return true;
  }

  if (cmd === "last-analysis") {
    const meal = await getLastMeal(db, userId);
    if (!meal) {
      await sendOut(
        channel,
        db,
        chatId,
        userId,
        channel.name,
        "no meals logged yet",
        replyToken,
      );
      return true;
    }
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      `last meal: ${meal.description || "meal"}\n` +
        `totals: ${Math.round(Number(meal.calories))} kcal, ` +
        `P${Math.round(Number(meal.protein_g))}g ` +
        `C${Math.round(Number(meal.carbs_g))}g ` +
        `F${Math.round(Number(meal.fat_g))}g`,
      replyToken,
    );
    return true;
  }

  return false;
}

export { sendOut };
