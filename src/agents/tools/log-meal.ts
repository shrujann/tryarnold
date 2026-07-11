import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { insertMeal } from "../../db/meals";
import type { UserRow } from "../../db/users";
import { macroEstimateSchema } from "../../schemas/nutrition";
import { formatMealLoggedPlain } from "../../services/meal-format";

const logMealSchema = macroEstimateSchema.extend({
  description: z.string().describe("Short meal description"),
});

export function createLogMealFromTextTool(db: D1Database, user: UserRow) {
  return tool(
    async (input) => {
      const parsed = logMealSchema.parse(input);
      await insertMeal(db, {
        userId: user.id,
        source: "text",
        estimate: parsed,
      });
      return formatMealLoggedPlain(parsed);
    },
    {
      name: "log_meal_from_text",
      description:
        "Extract and persist a meal from user text. Call when the user describes food they ate.",
      schema: logMealSchema,
    },
  );
}
