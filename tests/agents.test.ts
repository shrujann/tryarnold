/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import type { UserRow } from "../src/db/users";

vi.mock("@langchain/core/tools", () => ({
  tool: (_fn: unknown, config: { name: string }) => ({ name: config.name }),
}));

vi.mock("../src/db/users", () => ({
  dailyTotals: vi.fn(),
  getRecentMeals: vi.fn(),
}));

vi.mock("../src/db/meals", () => ({
  insertMeal: vi.fn(),
}));

import { createCoachTools } from "../src/agents/tools";

describe("coach tools", () => {
  it("creates three tools with expected names", () => {
    const user = { id: 1, timezone: "UTC" } as UserRow;
    const tools = createCoachTools({} as never, {} as D1Database, user);
    expect(tools.map((t) => t.name)).toEqual([
      "get_progress",
      "get_recent_meals",
      "log_meal_from_text",
    ]);
  });
});
