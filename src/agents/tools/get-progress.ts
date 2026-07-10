import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDailyProgress } from "../../db/users";
import type { UserRow } from "../../db/users";

export function createGetProgressTool(db: D1Database, user: UserRow) {
  return tool(
    async () => {
      const progress = await getDailyProgress(db, user);
      return JSON.stringify({
        calories: Math.round(progress.calories),
        protein_g: Math.round(progress.protein_g),
        carbs_g: Math.round(progress.carbs_g),
        fat_g: Math.round(progress.fat_g),
        meals: progress.meals,
        target_calories: progress.target_calories,
        target_protein_g: progress.target_protein_g,
        target_carbs_g: progress.target_carbs_g,
        target_fat_g: progress.target_fat_g,
        remaining_calories:
          progress.remaining_calories != null
            ? Math.round(progress.remaining_calories)
            : null,
        remaining_protein_g:
          progress.remaining_protein_g != null
            ? Math.round(progress.remaining_protein_g)
            : null,
      });
    },
    {
      name: "get_progress",
      description: "Get today's calorie and macro totals vs user targets",
      schema: z.object({}),
    },
  );
}
