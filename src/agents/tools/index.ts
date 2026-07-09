import type { Env } from "../../env";
import type { UserRow } from "../../db/users";
import { createGetProgressTool } from "./get-progress";
import { createGetRecentMealsTool } from "./get-recent-meals";
import { createLogMealFromTextTool } from "./log-meal";

export function createCoachTools(env: Env, db: D1Database, user: UserRow) {
  return [
    createGetProgressTool(db, user),
    createGetRecentMealsTool(db, user.id),
    createLogMealFromTextTool(db, user),
  ];
}

export { createGetProgressTool } from "./get-progress";
export { createGetRecentMealsTool } from "./get-recent-meals";
export { createLogMealFromTextTool } from "./log-meal";
