import { dailyTotals, getRecentMeals } from "../db/users";
import { getRecentMessages } from "../db/messages";
import type { UserRow } from "../db/users";

export async function buildRecentContext(
  db: D1Database,
  user: UserRow,
): Promise<string> {
  const totals = await dailyTotals(db, user);
  const meals = await getRecentMeals(db, user.id, 5);
  const messages = await getRecentMessages(db, user.id, 8);

  const lines = [
    `user_id=${user.id} timezone=${user.timezone || "UTC"}`,
    `goal=${user.goal_summary || "not set"}`,
    `today=${Math.round(totals.calories)} kcal P${Math.round(totals.protein_g)} C${Math.round(totals.carbs_g)} F${Math.round(totals.fat_g)} meals=${totals.meals}`,
  ];

  if (meals.length) {
    lines.push("recent meals:");
    for (const meal of meals) {
      lines.push(
        `- ${meal.description || "meal"}: ${Math.round(Number(meal.calories))} kcal`,
      );
    }
  }

  if (messages.length) {
    lines.push("recent chat (newest first):");
    for (const message of messages) {
      const content = String(message.content ?? "").slice(0, 180);
      lines.push(`- ${message.direction}: ${content}`);
    }
  }

  return lines.join("\n");
}
