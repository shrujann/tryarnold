import type { MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { dailyTotals } from "../db/users";
import { getLastMeal } from "../db/meals";
import { stripEmoji } from "../services/text-style";
import { LineChannel } from "../channels/line";

export const HELP =
  "how this works:\n" +
  "- text me what you ate or send a food photo\n" +
  "- /progress - today's summary\n" +
  "- /last-analysis - last logged meal\n" +
  "- /help - this message\n\n" +
  "note: proactive check-ins, pdf reports, and fatsecret are not on this worker.";

export const WELCOME =
  "hey, i'm your fitness coach. text meals or send food pics and i'll track " +
  "them.\n\nwhat's the main goal right now?";

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
  if (channel instanceof LineChannel && replyToken) {
    await channel.sendText(chatId, cleaned, replyToken);
  } else {
    await channel.sendText(chatId, cleaned);
  }
  const { logMessage } = await import("../db/messages");
  await logMessage(db, userId, "out", cleaned, channelName);
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

  if (cmd === "start" || cmd === "help") {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      cmd === "help" ? HELP : WELCOME,
      replyToken,
    );
    return true;
  }

  if (cmd === "progress") {
    const totals = await dailyTotals(db, user);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      `today: ${Math.round(totals.calories)} kcal, ` +
        `P${Math.round(totals.protein_g)}g ` +
        `C${Math.round(totals.carbs_g)}g ` +
        `F${Math.round(totals.fat_g)}g, ` +
        `${totals.meals} meal(s)`,
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
