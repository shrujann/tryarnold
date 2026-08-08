import { dbAll, dbFirst, dbRun, startOfDayInTimezone, utcNow } from "./client";
import type { MacroEstimate } from "../schemas/nutrition";

export interface MealRow {
  id: number;
  user_id: number;
  ts: string;
  source: string;
  description: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: number | null;
  items_json: string | null;
  media_ref: string | null;
  media_unique_ref: string | null;
  photo_caption: string | null;
}

export async function insertMeal(
  db: D1Database,
  params: {
    userId: number;
    source: string;
    estimate: MacroEstimate;
    mediaRef?: string | null;
    mediaUniqueRef?: string | null;
    photoCaption?: string | null;
  },
): Promise<void> {
  const { userId, source, estimate, mediaRef, mediaUniqueRef, photoCaption } = params;
  await dbRun(
    db,
    `INSERT INTO meals (
      user_id, ts, source, description, calories, protein_g, carbs_g, fat_g,
      confidence, items_json, media_ref, media_unique_ref, photo_caption
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    utcNow(),
    source,
    estimate.description,
    estimate.calories,
    estimate.protein_g,
    estimate.carbs_g,
    estimate.fat_g,
    estimate.confidence,
    JSON.stringify(estimate.items),
    mediaRef ?? null,
    mediaUniqueRef ?? null,
    photoCaption ?? null,
  );
}

export async function getLastMeal(
  db: D1Database,
  userId: number,
): Promise<Record<string, unknown> | null> {
  return dbFirst(
    db,
    "SELECT * FROM meals WHERE user_id = ? ORDER BY ts DESC LIMIT 1",
    userId,
  );
}

/** Deletes the user's most recently logged meal. Returns its description, or null if none. */
export async function deleteLastMeal(
  db: D1Database,
  userId: number,
): Promise<string | null> {
  const last = await getLastMeal(db, userId);
  if (!last || last.id == null) return null;

  await dbRun(
    db,
    "DELETE FROM meals WHERE id = ? AND user_id = ?",
    last.id,
    userId,
  );

  const description = last.description;
  return typeof description === "string" && description.trim()
    ? description.trim()
    : "meal";
}

/** Today's meals for /report, oldest first, including photo refs. */
export async function getMealsForDay(
  db: D1Database,
  userId: number,
  timezone: string,
): Promise<MealRow[]> {
  const start = startOfDayInTimezone(timezone || "UTC");
  const rows = await dbAll(
    db,
    `SELECT id, user_id, ts, source, description, calories, protein_g, carbs_g, fat_g,
            confidence, items_json, media_ref, media_unique_ref, photo_caption
     FROM meals
     WHERE user_id = ? AND ts >= ?
     ORDER BY ts ASC`,
    userId,
    start,
  );
  return rows as unknown as MealRow[];
}
