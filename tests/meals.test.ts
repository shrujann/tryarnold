import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  dbFirst: vi.fn(),
  dbRun: vi.fn(),
  utcNow: vi.fn(() => "2026-07-09T00:00:00Z"),
}));

import { dbFirst, dbRun } from "../src/db/client";
import { deleteLastMeal, getLastMeal } from "../src/db/meals";

describe("deleteLastMeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the most recent meal and returns its description", async () => {
    vi.mocked(dbFirst).mockResolvedValue({
      id: 9,
      user_id: 1,
      description: "iced coffee",
    });

    const result = await deleteLastMeal({} as D1Database, 1);

    expect(result).toBe("iced coffee");
    expect(dbRun).toHaveBeenCalledWith(
      expect.anything(),
      "DELETE FROM meals WHERE id = ? AND user_id = ?",
      9,
      1,
    );
  });

  it("returns null when no meals exist", async () => {
    vi.mocked(dbFirst).mockResolvedValue(null);

    const result = await deleteLastMeal({} as D1Database, 1);

    expect(result).toBeNull();
    expect(dbRun).not.toHaveBeenCalled();
  });

  it("falls back to meal when description is empty", async () => {
    vi.mocked(dbFirst).mockResolvedValue({
      id: 2,
      user_id: 1,
      description: "  ",
    });

    const result = await deleteLastMeal({} as D1Database, 1);

    expect(result).toBe("meal");
  });
});

describe("getLastMeal", () => {
  it("queries the latest meal for the user", async () => {
    vi.mocked(dbFirst).mockResolvedValue({ id: 1, description: "salad" });

    const meal = await getLastMeal({} as D1Database, 3);

    expect(meal).toMatchObject({ description: "salad" });
    expect(dbFirst).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("ORDER BY ts DESC LIMIT 1"),
      3,
    );
  });
});
