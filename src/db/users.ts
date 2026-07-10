import type { InboundMessage } from "../channels/types";
import { dbAll, dbFirst, dbRun, startOfDayInTimezone, utcNow } from "./client";
import type { ActivityLevel, FitnessGoal, Gender, ProfileInput } from "../services/tdee";
import {
  activitySummaryLabel,
  goalSummaryLabel,
  type OnboardingStep,
} from "../services/onboarding";
import { computeFullTargets } from "../services/tdee";
import { formatHeight, formatWeight, type UnitPreference } from "../services/units";

export interface UserRow {
  id: number;
  channel?: string | null;
  external_user_id?: string | null;
  username?: string | null;
  first_name?: string | null;
  timezone?: string | null;
  goal_summary?: string | null;
  portion_multiplier?: number | null;
  onboarded?: number | null;
  onboarding_step?: string | null;
  gender?: string | null;
  age?: number | null;
  weight_kg?: number | null;
  height_cm?: number | null;
  unit_preference?: string | null;
  activity_level?: string | null;
  fitness_goal?: string | null;
  bmr?: number | null;
  tdee?: number | null;
  target_calories?: number | null;
  target_protein_g?: number | null;
  target_carbs_g?: number | null;
  target_fat_g?: number | null;
  [key: string]: unknown;
}

export interface DailyProgress {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meals: number;
  target_calories: number | null;
  target_protein_g: number | null;
  target_carbs_g: number | null;
  target_fat_g: number | null;
  remaining_calories: number | null;
  remaining_protein_g: number | null;
  remaining_carbs_g: number | null;
  remaining_fat_g: number | null;
}

export interface OnboardingUpdate {
  gender?: Gender;
  age?: number;
  weight_kg?: number;
  height_cm?: number;
  unit_preference?: UnitPreference;
  activity_level?: ActivityLevel;
  fitness_goal?: FitnessGoal;
  onboarding_step?: OnboardingStep | "done";
}

function asUser(row: Record<string, unknown> | null): UserRow | null {
  if (!row) return null;
  return row as UserRow;
}

function profileFromUser(user: UserRow): ProfileInput | null {
  const gender = user.gender as Gender | null;
  const age = Number(user.age);
  const weightKg = Number(user.weight_kg);
  const heightCm = Number(user.height_cm);
  const activityLevel = user.activity_level as ActivityLevel | null;
  const fitnessGoal = user.fitness_goal as FitnessGoal | null;

  if (
    !gender ||
    !Number.isFinite(age) ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    !activityLevel ||
    !fitnessGoal
  ) {
    return null;
  }

  return {
    gender,
    age,
    weightKg,
    heightCm,
    activityLevel,
    fitnessGoal,
  };
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
      channel, external_user_id, username, first_name,
      timezone, nudges_enabled, consent_health_data, phone_verified,
      onboarded, onboarding_step, portion_multiplier, created_at
    ) VALUES (?, ?, ?, ?, 'UTC', 1, 0, 0, 0, NULL, 1.0, ?)`,
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

export async function updateOnboardingStep(
  db: D1Database,
  userId: number,
  fields: OnboardingUpdate,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (!sets.length) return;
  values.push(userId);
  await dbRun(db, `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...values);
}

export async function completeOnboarding(
  db: D1Database,
  userId: number,
): Promise<UserRow> {
  const user = asUser(await dbFirst(db, "SELECT * FROM users WHERE id = ?", userId));
  if (!user) throw new Error("user not found");

  const profile = profileFromUser(user);
  if (!profile) throw new Error("incomplete onboarding profile");

  const { bmr, tdee, targets } = computeFullTargets(profile);
  const goalSummary = goalSummaryLabel(profile.fitnessGoal);

  await dbRun(
    db,
    `UPDATE users SET
      bmr = ?, tdee = ?,
      target_calories = ?, target_protein_g = ?, target_carbs_g = ?, target_fat_g = ?,
      goal_summary = ?, onboarded = 1, onboarding_step = 'done'
     WHERE id = ?`,
    Math.round(bmr * 10) / 10,
    Math.round(tdee),
    targets.calories,
    targets.protein_g,
    targets.carbs_g,
    targets.fat_g,
    goalSummary,
    userId,
  );

  const updated = asUser(await dbFirst(db, "SELECT * FROM users WHERE id = ?", userId));
  if (!updated) throw new Error("failed to reload user");
  return updated;
}

export async function restartOnboarding(db: D1Database, userId: number): Promise<void> {
  await dbRun(
    db,
    `UPDATE users SET
      onboarded = 0, onboarding_step = 'unit',
      gender = NULL, age = NULL, weight_kg = NULL, height_cm = NULL,
      activity_level = NULL, fitness_goal = NULL,
      bmr = NULL, tdee = NULL,
      target_calories = NULL, target_protein_g = NULL,
      target_carbs_g = NULL, target_fat_g = NULL
     WHERE id = ?`,
    userId,
  );
}

export function getProfileSummary(user: UserRow): string {
  const pref: UnitPreference =
    user.unit_preference === "imperial" ? "imperial" : "metric";
  const profile = profileFromUser(user);
  if (!profile) return "profile incomplete";

  const weight = formatWeight(profile.weightKg, pref);
  const height = formatHeight(profile.heightCm, pref);
  const activity = activitySummaryLabel(profile.activityLevel);
  const goal = goalSummaryLabel(profile.fitnessGoal);

  const lines = [
    `goal: ${goal}`,
    `targets: ${user.target_calories ?? "?"} kcal, P${user.target_protein_g ?? "?"}g C${user.target_carbs_g ?? "?"}g F${user.target_fat_g ?? "?"}g`,
    `stats: ${profile.gender}, ${profile.age}y, ${weight}, ${height}`,
    `activity: ${activity}`,
    `tdee: ~${Math.round(Number(user.tdee ?? 0))} kcal/day`,
  ];
  return lines.join("\n");
}

export async function getDailyProgress(
  db: D1Database,
  user: UserRow,
): Promise<DailyProgress> {
  const totals = await dailyTotals(db, user);
  const targetCal = user.target_calories != null ? Number(user.target_calories) : null;
  const targetP = user.target_protein_g != null ? Number(user.target_protein_g) : null;
  const targetC = user.target_carbs_g != null ? Number(user.target_carbs_g) : null;
  const targetF = user.target_fat_g != null ? Number(user.target_fat_g) : null;

  return {
    ...totals,
    target_calories: targetCal,
    target_protein_g: targetP,
    target_carbs_g: targetC,
    target_fat_g: targetF,
    remaining_calories: targetCal != null ? targetCal - totals.calories : null,
    remaining_protein_g: targetP != null ? targetP - totals.protein_g : null,
    remaining_carbs_g: targetC != null ? targetC - totals.carbs_g : null,
    remaining_fat_g: targetF != null ? targetF - totals.fat_g : null,
  };
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
