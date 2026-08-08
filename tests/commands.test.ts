import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "../src/db/users";
import type { MessagingChannel } from "../src/channels/types";
import type { Env } from "../src/env";

vi.mock("../src/db/users", () => ({
  getDailyProgress: vi.fn(),
  updateOnboardingStep: vi.fn(),
}));

vi.mock("../src/db/meals", () => ({
  deleteLastMeal: vi.fn(),
  getLastMeal: vi.fn(),
  getMealsForDay: vi.fn(),
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

import { deleteLastMeal, getMealsForDay } from "../src/db/meals";
import { getDailyProgress } from "../src/db/users";
import { handleCommand } from "../src/handlers/commands";

const mockChannel: MessagingChannel = {
  name: "telegram",
  enabled: true,
  sendText: vi.fn(),
  sendTextWithKeyboard: vi.fn(),
  sendPhoto: vi.fn(),
  downloadPhoto: vi.fn(),
  parseUpdate: () => null,
};

const user = { id: 5, onboarded: 1, timezone: "UTC" } as UserRow;
const db = {} as D1Database;
const testEnv = { PUBLIC_BASE_URL: "https://example.com" } as Env;

describe("/undo command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the last meal when one exists", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue("pizza");

    const handled = await handleCommand(testEnv, mockChannel, db, 99, user, "/undo");

    expect(handled).toBe(true);
    expect(deleteLastMeal).toHaveBeenCalledWith(db, 5);
    expect(mockChannel.sendText).toHaveBeenCalledWith(99, "removed pizza", undefined);
  });

  it("reports nothing to remove when empty", async () => {
    vi.mocked(deleteLastMeal).mockResolvedValue(null);

    await handleCommand(testEnv, mockChannel, db, 99, user, "/undo");

    expect(mockChannel.sendText).toHaveBeenCalledWith(99, "nothing to remove", undefined);
  });
});

describe("/report command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a header plus photo cards for today's meals", async () => {
    vi.mocked(getDailyProgress).mockResolvedValue({
      calories: 500,
      protein_g: 20,
      carbs_g: 40,
      fat_g: 15,
      meals: 1,
      target_calories: 2000,
      target_protein_g: 150,
      target_carbs_g: 200,
      target_fat_g: 60,
      remaining_calories: 1500,
      remaining_protein_g: 130,
      remaining_carbs_g: 160,
      remaining_fat_g: 45,
    });
    vi.mocked(getMealsForDay).mockResolvedValue([
      {
        id: 1,
        user_id: 5,
        ts: "2026-08-08T04:30:00.000Z",
        source: "photo",
        description: "salad",
        calories: 500,
        protein_g: 20,
        carbs_g: 40,
        fat_g: 15,
        confidence: 0.8,
        items_json: JSON.stringify([]),
        media_ref: "file-1",
        media_unique_ref: "uniq-1",
        photo_caption: null,
      },
    ]);

    const handled = await handleCommand(testEnv, mockChannel, db, 99, user, "/report");

    expect(handled).toBe(true);
    expect(mockChannel.sendText).toHaveBeenCalledWith(
      99,
      expect.stringContaining("today's report: 500 kcal"),
      undefined,
    );
    expect(mockChannel.sendPhoto).toHaveBeenCalledWith(
      99,
      expect.objectContaining({
        fileId: "file-1",
        caption: expect.stringContaining("<b>salad</b> — 500 kcal"),
        parseMode: "HTML",
      }),
    );
  });

  it("tells the user when no meals are logged", async () => {
    vi.mocked(getDailyProgress).mockResolvedValue({
      calories: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      meals: 0,
      target_calories: 2000,
      target_protein_g: null,
      target_carbs_g: null,
      target_fat_g: null,
      remaining_calories: 2000,
      remaining_protein_g: null,
      remaining_carbs_g: null,
      remaining_fat_g: null,
    });
    vi.mocked(getMealsForDay).mockResolvedValue([]);

    await handleCommand(testEnv, mockChannel, db, 99, user, "/report");

    expect(mockChannel.sendText).toHaveBeenCalledWith(
      99,
      "no meals logged today yet. send a food photo to start.",
      undefined,
    );
    expect(mockChannel.sendPhoto).not.toHaveBeenCalled();
  });
});
