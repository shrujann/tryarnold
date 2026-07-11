import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "../src/db/users";
import type { MessagingChannel } from "../src/channels/types";

vi.mock("../src/db/users", () => ({
  getDailyProgress: vi.fn(),
  updateOnboardingStep: vi.fn(),
}));

vi.mock("../src/db/meals", () => ({
  deleteLastMeal: vi.fn(),
  getLastMeal: vi.fn(),
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

import { deleteLastMeal } from "../src/db/meals";
import { handleCommand } from "../src/handlers/commands";

const mockChannel: MessagingChannel = {
  name: "telegram",
  enabled: true,
  sendText: vi.fn(),
  sendTextWithKeyboard: vi.fn(),
  downloadPhoto: vi.fn(),
  parseUpdate: () => null,
};

const user = { id: 5, onboarded: 1 } as UserRow;
const db = {} as D1Database;

describe("/undo command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the last meal when one exists", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue("pizza");

    const handled = await handleCommand(mockChannel, db, 99, user, "/undo");

    expect(handled).toBe(true);
    expect(deleteLastMeal).toHaveBeenCalledWith(db, 5);
    expect(mockChannel.sendText).toHaveBeenCalledWith(99, "removed pizza", undefined);
  });

  it("reports nothing to remove when empty", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue(null);

    await handleCommand(mockChannel, db, 99, user, "/undo");

    expect(mockChannel.sendText).toHaveBeenCalledWith(99, "nothing to remove", undefined);
  });
});
