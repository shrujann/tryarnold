import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { dailyTotals } from "../../db/users";
import type { UserRow } from "../../db/users";

export function createGetProgressTool(db: D1Database, user: UserRow) {
  return tool(
    async () => {
      const totals = await dailyTotals(db, user);
      return JSON.stringify({
        calories: Math.round(totals.calories),
        protein_g: Math.round(totals.protein_g),
        carbs_g: Math.round(totals.carbs_g),
        fat_g: Math.round(totals.fat_g),
        meals: totals.meals,
      });
    },
    {
      name: "get_progress",
      description: "Get today's calorie and macro totals for the user",
      schema: z.object({}),
    },
  );
}
