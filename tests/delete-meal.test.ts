import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "../src/db/users";

vi.mock("@langchain/core/tools", () => ({
  tool: (fn: (...args: unknown[]) => unknown, config: { name: string }) => ({
    name: config.name,
    invoke: fn,
  }),
}));

vi.mock("../src/db/meals", () => ({
  deleteLastMeal: vi.fn(),
}));

import { deleteLastMeal } from "../src/db/meals";
import { createDeleteLastMealTool } from "../src/agents/tools/delete-meal";

describe("delete_last_meal tool", () => {
  const user = { id: 1 } as UserRow;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns removed description when a meal exists", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue("salad");
    const tool = createDeleteLastMealTool({} as D1Database, user) as {
      invoke: () => Promise<string>;
    };

    await expect(tool.invoke()).resolves.toBe("removed salad");
    expect(deleteLastMeal).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it("returns nothing to remove when empty", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue(null);
    const tool = createDeleteLastMealTool({} as D1Database, user) as {
      invoke: () => Promise<string>;
    };

    await expect(tool.invoke()).resolves.toBe("nothing to remove");
  });
});
