import { dbFirst, dbRun, utcNow } from "./client";
import type { MacroEstimate } from "../schemas/nutrition";
import type { ClarifyPlan } from "../services/clarification";

export type PendingMealPhase =
  | "clarifying_toggle"
  | "clarifying_exclusive"
  | "confirm"
  | "editing"
  | "reviewing_edit";

export interface PendingMealRow {
  id: number;
  user_id: number;
  estimate_json: string;
  base_multiplier: number;
  media_ref?: string | null;
  media_unique_ref?: string | null;
  photo_caption?: string | null;
  created_at: string;
  phase?: PendingMealPhase | string | null;
  clarify_plan_json?: string | null;
  clarify_selected_json?: string | null;
  clarify_exclusive_choice?: string | null;
  ui_message_id?: string | null;
  fatsecret_prefetch_json?: string | null;
  proposed_estimate_json?: string | null;
}

export function parseClarifyPlan(row: PendingMealRow): ClarifyPlan | null {
  if (!row.clarify_plan_json) return null;
  try {
    return JSON.parse(row.clarify_plan_json) as ClarifyPlan;
  } catch {
    return null;
  }
}

export function parseSelectedToggleIds(row: PendingMealRow): string[] {
  if (!row.clarify_selected_json) return [];
  try {
    const parsed = JSON.parse(row.clarify_selected_json);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
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
    phase?: PendingMealPhase;
    clarifyPlan?: ClarifyPlan | null;
    selectedToggleIds?: string[];
    exclusiveChoice?: string | null;
    uiMessageId?: string | null;
  },
): Promise<void> {
  const {
    userId,
    estimate,
    baseMultiplier,
    mediaRef,
    mediaUniqueRef,
    photoCaption,
    phase = "confirm",
    clarifyPlan = null,
    selectedToggleIds = [],
    exclusiveChoice = null,
    uiMessageId = null,
  } = params;

  await dbRun(db, "DELETE FROM pending_meals WHERE user_id = ?", userId);
  await dbRun(
    db,
    `INSERT INTO pending_meals (
      user_id, estimate_json, base_multiplier, media_ref, media_unique_ref,
      photo_caption, created_at, phase, clarify_plan_json, clarify_selected_json,
      clarify_exclusive_choice, ui_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    JSON.stringify(estimate),
    baseMultiplier,
    mediaRef ?? null,
    mediaUniqueRef ?? null,
    photoCaption ?? null,
    utcNow(),
    phase,
    clarifyPlan ? JSON.stringify(clarifyPlan) : null,
    JSON.stringify(selectedToggleIds),
    exclusiveChoice,
    uiMessageId != null ? String(uiMessageId) : null,
  );
}

type PendingMealPatch = {
  estimate?: MacroEstimate;
  phase?: PendingMealPhase;
  clarifyPlan?: ClarifyPlan | null;
  selectedToggleIds?: string[];
  exclusiveChoice?: string | null;
  uiMessageId?: string | null;
  fatsecretPrefetch?: import("../services/fatsecret").FatSecretPrefetchCache | null;
  proposedEdit?: import("../services/meal-edit-review").ProposedMealEdit | null;
};

function buildPendingMealPatchSets(patch: PendingMealPatch): {
  sets: string[];
  values: unknown[];
} {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.estimate !== undefined) {
    sets.push("estimate_json = ?");
    values.push(JSON.stringify(patch.estimate));
  }
  if (patch.phase !== undefined) {
    sets.push("phase = ?");
    values.push(patch.phase);
  }
  if (patch.clarifyPlan !== undefined) {
    sets.push("clarify_plan_json = ?");
    values.push(patch.clarifyPlan ? JSON.stringify(patch.clarifyPlan) : null);
  }
  if (patch.selectedToggleIds !== undefined) {
    sets.push("clarify_selected_json = ?");
    values.push(JSON.stringify(patch.selectedToggleIds));
  }
  if (patch.exclusiveChoice !== undefined) {
    sets.push("clarify_exclusive_choice = ?");
    values.push(patch.exclusiveChoice);
  }
  if (patch.uiMessageId !== undefined) {
    sets.push("ui_message_id = ?");
    values.push(patch.uiMessageId != null ? String(patch.uiMessageId) : null);
  }
  if (patch.fatsecretPrefetch !== undefined) {
    sets.push("fatsecret_prefetch_json = ?");
    values.push(
      patch.fatsecretPrefetch ? JSON.stringify(patch.fatsecretPrefetch) : null,
    );
  }
  if (patch.proposedEdit !== undefined) {
    sets.push("proposed_estimate_json = ?");
    values.push(patch.proposedEdit ? JSON.stringify(patch.proposedEdit) : null);
  }

  return { sets, values };
}

export async function updatePendingMeal(
  db: D1Database,
  userId: number,
  patch: PendingMealPatch,
): Promise<void> {
  const { sets, values } = buildPendingMealPatchSets(patch);
  if (sets.length === 0) return;

  values.push(userId);
  await dbRun(
    db,
    `UPDATE pending_meals SET ${sets.join(", ")} WHERE user_id = ?`,
    ...values,
  );
}

/** Conditionally update a specific pending row; returns false if it was replaced. */
export async function updatePendingMealIf(
  db: D1Database,
  userId: number,
  expectedId: number,
  patch: PendingMealPatch,
): Promise<boolean> {
  const { sets, values } = buildPendingMealPatchSets(patch);
  if (sets.length === 0) return true;

  values.push(userId, expectedId);
  const changes = await dbRun(
    db,
    `UPDATE pending_meals SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
    ...values,
  );
  return changes > 0;
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

export function pendingPhase(row: PendingMealRow): PendingMealPhase {
  const phase = row.phase ?? "confirm";
  if (
    phase === "clarifying_toggle" ||
    phase === "clarifying_exclusive" ||
    phase === "confirm" ||
    phase === "editing" ||
    phase === "reviewing_edit"
  ) {
    return phase;
  }
  return "confirm";
}
