import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { deleteLastMeal } from "../../db/meals";
import type { UserRow } from "../../db/users";

export function createDeleteLastMealTool(db: D1Database, user: UserRow) {
  return tool(
    async () => {
      const description = await deleteLastMeal(db, user.id);
      if (!description) return "nothing to remove";
      return `removed ${description}`;
    },
    {
      name: "delete_last_meal",
      description:
        "Remove the user's most recently logged meal. Use when they ask to undo, delete, or remove their last meal.",
      schema: z.object({}),
    },
  );
}
