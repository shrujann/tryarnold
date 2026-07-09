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

  it("creates LINE users without requiring telegram_id", async () => {
    vi.mocked(dbFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 7,
        channel: "line",
        external_user_id: "U123",
        telegram_id: null,
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
      null,
      "line",
      "U123",
      null,
      null,
      "2026-07-09T00:00:00Z",
    );
    expect(user).toMatchObject({ id: 7, channel: "line", external_user_id: "U123" });
  });
});
