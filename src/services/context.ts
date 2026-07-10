import { getDailyProgress, getRecentMeals } from "../db/users";
import { getRecentMessages } from "../db/messages";
import type { UserRow } from "../db/users";

export async function buildRecentContext(
  db: D1Database,
  user: UserRow,
): Promise<string> {
  const progress = await getDailyProgress(db, user);
  const meals = await getRecentMeals(db, user.id, 5);
  const messages = await getRecentMessages(db, user.id, 8);

  const lines = [
    `user_id=${user.id} timezone=${user.timezone || "UTC"}`,
    `goal=${user.goal_summary || "not set"}`,
    `today=${Math.round(progress.calories)} kcal P${Math.round(progress.protein_g)} C${Math.round(progress.carbs_g)} F${Math.round(progress.fat_g)} meals=${progress.meals}`,
  ];

  if (progress.target_calories != null) {
    lines.push(
      `targets=${progress.target_calories} kcal P${progress.target_protein_g} C${progress.target_carbs_g} F${progress.target_fat_g}`,
    );
    if (progress.remaining_calories != null) {
      lines.push(`remaining_kcal=${Math.round(progress.remaining_calories)}`);
    }
  }

  if (user.tdee != null) {
    lines.push(`tdee=${Math.round(Number(user.tdee))}`);
  }

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
