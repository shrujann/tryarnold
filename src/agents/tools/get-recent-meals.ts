import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getRecentMeals } from "../../db/users";

export function createGetRecentMealsTool(db: D1Database, userId: number) {
  return tool(
    async () => {
      const meals = await getRecentMeals(db, userId, 5);
      return JSON.stringify(
        meals.map((m) => ({
          description: m.description,
          calories: Math.round(Number(m.calories)),
          ts: m.ts,
        })),
      );
    },
    {
      name: "get_recent_meals",
      description: "Get the user's most recent logged meals",
      schema: z.object({}),
    },
  );
}
