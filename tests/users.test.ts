import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  dbFirst: vi.fn(),
  dbRun: vi.fn(),
  dbAll: vi.fn(),
  startOfDayInTimezone: vi.fn(),
  utcNow: vi.fn(() => "2026-07-09T00:00:00Z"),
}));

import { dbFirst, dbRun } from "../src/db/client";
import { getOrCreateUser } from "../src/db/users";

describe("getOrCreateUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates LINE users with channel + external_user_id", async () => {
    vi.mocked(dbFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 7,
        channel: "line",
        external_user_id: "U123",
      } as never);

    const user = await getOrCreateUser({} as D1Database, {
      channel: "line",
      externalUserId: "U123",
      chatId: "U123",
      text: "hello",
    });

    expect(dbRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("INSERT INTO users"),
      "line",
      "U123",
      null,
      null,
      "2026-07-09T00:00:00Z",
    );
    expect(user).toMatchObject({
      id: 7,
      channel: "line",
      external_user_id: "U123",
    });
  });

  it("insert leaves onboarding_step null until /start", async () => {
    vi.mocked(dbFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, onboarding_step: null, onboarded: 0 } as never);

    await getOrCreateUser({} as D1Database, {
      channel: "telegram",
      externalUserId: "99",
      chatId: 99,
    });

    const insertCall = vi.mocked(dbRun).mock.calls[0];
    expect(insertCall?.[1]).toContain("onboarding_step");
    expect(insertCall?.[1]).toContain("NULL");
    expect(insertCall?.[1]).not.toContain("'unit'");
  });
});
