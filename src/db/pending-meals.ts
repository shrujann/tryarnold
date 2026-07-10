import { dbFirst, dbRun, utcNow } from "./client";
import type { MacroEstimate } from "../schemas/nutrition";

export interface PendingMealRow {
  id: number;
  user_id: number;
  estimate_json: string;
  base_multiplier: number;
  media_ref?: string | null;
  media_unique_ref?: string | null;
  photo_caption?: string | null;
  created_at: string;
}

export async function deletePendingMeal(db: D1Database, userId: number): Promise<void> {
  await dbRun(db, "DELETE FROM pending_meals WHERE user_id = ?", userId);
}

export async function insertPendingMeal(
  db: D1Database,
  params: {
    userId: number;
    estimate: MacroEstimate;
    baseMultiplier: number;
    mediaRef?: string | null;
    mediaUniqueRef?: string | null;
    photoCaption?: string | null;
  },
): Promise<void> {
  const { userId, estimate, baseMultiplier, mediaRef, mediaUniqueRef, photoCaption } =
    params;
  await dbRun(db, "DELETE FROM pending_meals WHERE user_id = ?", userId);
  await dbRun(
    db,
    `INSERT INTO pending_meals (
      user_id, estimate_json, base_multiplier, media_ref, media_unique_ref,
      photo_caption, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    userId,
    JSON.stringify(estimate),
    baseMultiplier,
    mediaRef ?? null,
    mediaUniqueRef ?? null,
    photoCaption ?? null,
    utcNow(),
  );
}

export async function getPendingMeal(
  db: D1Database,
  userId: number,
): Promise<PendingMealRow | null> {
  const row = await dbFirst(db, "SELECT * FROM pending_meals WHERE user_id = ?", userId);
  if (!row) return null;
  return row as unknown as PendingMealRow;
}

export function isPendingMealExpired(
  pending: PendingMealRow,
  ttlMinutes: number,
): boolean {
  const created = new Date(pending.created_at).getTime();
  if (Number.isNaN(created)) return true;
  return Date.now() - created > ttlMinutes * 60 * 1000;
}
