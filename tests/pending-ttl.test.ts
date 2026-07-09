import { describe, expect, it } from "vitest";
import { isPendingMealExpired } from "../src/db/pending-meals";

describe("isPendingMealExpired", () => {
  it("returns true when past TTL", () => {
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(
      isPendingMealExpired(
        {
          id: 1,
          user_id: 1,
          estimate_json: "{}",
          base_multiplier: 1,
          created_at: old,
        },
        30,
      ),
    ).toBe(true);
  });

  it("returns false when within TTL", () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(
      isPendingMealExpired(
        {
          id: 1,
          user_id: 1,
          estimate_json: "{}",
          base_multiplier: 1,
          created_at: recent,
        },
        30,
      ),
    ).toBe(false);
  });
});
