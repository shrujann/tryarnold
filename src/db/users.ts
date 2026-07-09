import type { InboundMessage } from "../channels/types";
import { dbAll, dbFirst, dbRun, startOfDayInTimezone, utcNow } from "./client";

export interface UserRow {
  id: number;
  telegram_id?: number | null;
  channel?: string | null;
  external_user_id?: string | null;
  username?: string | null;
  first_name?: string | null;
  timezone?: string | null;
  goal_summary?: string | null;
  portion_multiplier?: number | null;
  [key: string]: unknown;
}

function asUser(row: Record<string, unknown> | null): UserRow | null {
  if (!row) return null;
  return row as UserRow;
}

export async function getOrCreateUser(
  db: D1Database,
  msg: InboundMessage,
): Promise<UserRow> {
  const externalId = String(msg.externalUserId);
  const channel = msg.channel;

  let row = asUser(
    await dbFirst(
      db,
      "SELECT * FROM users WHERE channel = ? AND external_user_id = ?",
      channel,
      externalId,
    ),
  );

  if (!row && channel === "telegram") {
    row = asUser(
      await dbFirst(db, "SELECT * FROM users WHERE telegram_id = ?", Number(externalId)),
    );
    if (row) {
      await dbRun(
        db,
        "UPDATE users SET channel = ?, external_user_id = ? WHERE id = ?",
        channel,
        externalId,
        row.id,
      );
    }
  }

  if (row) {
    if (msg.username && row.username !== msg.username) {
      await dbRun(
        db,
        "UPDATE users SET username = ?, first_name = COALESCE(?, first_name) WHERE id = ?",
        msg.username,
        msg.firstName,
        row.id,
      );
    }
    const updated = asUser(await dbFirst(db, "SELECT * FROM users WHERE id = ?", row.id));
    if (!updated) throw new Error("failed to reload user");
    return updated;
  }

  await dbRun(
    db,
    `INSERT INTO users (
      telegram_id, channel, external_user_id, username, first_name,
      timezone, nudges_enabled, consent_health_data, phone_verified,
      onboarded, portion_multiplier, created_at
    ) VALUES (?, ?, ?, ?, ?, 'UTC', 1, 0, 0, 0, 1.0, ?)`,
    channel === "telegram" ? Number(externalId) : null,
    channel,
    externalId,
    msg.username ?? null,
    msg.firstName ?? null,
    utcNow(),
  );

  const created = asUser(
    await dbFirst(
      db,
      "SELECT * FROM users WHERE channel = ? AND external_user_id = ?",
      channel,
      externalId,
    ),
  );
  if (!created) throw new Error("failed to create user");
  return created;
}

export async function updatePortionMultiplier(
  db: D1Database,
  userId: number,
  multiplier: number,
): Promise<void> {
  await dbRun(
    db,
    "UPDATE users SET portion_multiplier = ? WHERE id = ?",
    Math.round(multiplier * 1000) / 1000,
    userId,
  );
}

export async function dailyTotals(
  db: D1Database,
  user: UserRow,
): Promise<{
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meals: number;
}> {
  const tz = (user.timezone as string) || "UTC";
  const start = startOfDayInTimezone(tz);
  const row = await dbFirst(
    db,
    `SELECT COALESCE(SUM(calories),0) AS calories,
            COALESCE(SUM(protein_g),0) AS protein_g,
            COALESCE(SUM(carbs_g),0) AS carbs_g,
            COALESCE(SUM(fat_g),0) AS fat_g,
            COUNT(*) AS meals
     FROM meals WHERE user_id = ? AND ts >= ?`,
    user.id,
    start,
  );
  return {
    calories: Number(row?.calories ?? 0),
    protein_g: Number(row?.protein_g ?? 0),
    carbs_g: Number(row?.carbs_g ?? 0),
    fat_g: Number(row?.fat_g ?? 0),
    meals: Number(row?.meals ?? 0),
  };
}

export async function getRecentMeals(
  db: D1Database,
  userId: number,
  limit = 5,
): Promise<Record<string, unknown>[]> {
  return dbAll(
    db,
    "SELECT description, calories, ts FROM meals WHERE user_id = ? ORDER BY ts DESC LIMIT ?",
    userId,
    limit,
  );
}
