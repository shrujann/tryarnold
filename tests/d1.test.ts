import { describe, expect, it, vi, beforeEach } from "vitest";
import { macroEstimateSchema } from "../src/schemas/nutrition";

vi.mock("../src/db/pending-meals", () => ({
  getPendingMeal: vi.fn(),
  deletePendingMeal: vi.fn(),
  isPendingMealExpired: vi.fn(() => false),
}));

vi.mock("../src/db/meals", () => ({
  insertMeal: vi.fn(),
}));

vi.mock("../src/db/users", () => ({
  updatePortionMultiplier: vi.fn(),
}));

vi.mock("../src/handlers/commands", () => ({
  sendOut: vi.fn(),
}));

import { getPendingMeal, deletePendingMeal } from "../src/db/pending-meals";
import { insertMeal } from "../src/db/meals";
import { handleConfirmation } from "../src/handlers/confirmation";
import { sendOut } from "../src/handlers/commands";
import type { Env } from "../src/env";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";

const testEnv = {
  PENDING_MEAL_TTL_MINUTES: "30",
  PORTION_SIZE_SMALL: "0.7",
  PORTION_SIZE_LARGE: "1.3",
} as Env;

const mockChannel: MessagingChannel = {
  name: "telegram",
  enabled: true,
  sendText: vi.fn(),
  sendTextWithKeyboard: vi.fn(),
  downloadPhoto: vi.fn(),
  parseUpdate: () => null,
  answerCallback: vi.fn(),
};

const user: UserRow = { id: 1, portion_multiplier: 1 };
const db = {} as D1Database;

describe("handleConfirmation D1 flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts meal and clears pending on log action", async () => {
    const estimate = macroEstimateSchema.parse({
      description: "salad",
      calories: 400,
      protein_g: 20,
      carbs_g: 30,
      fat_g: 15,
      portion_confidence: 0.8,
      food_confidence: 0.9,
      items: [],
    });

    vi.mocked(getPendingMeal).mockResolvedValue({
      id: 1,
      user_id: 1,
      estimate_json: JSON.stringify(estimate),
      base_multiplier: 1,
      media_ref: "f1",
      media_unique_ref: "fu1",
      photo_caption: null,
      created_at: new Date().toISOString(),
    });

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:log",
      callbackQueryId: "cb-1",
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "log");

    expect(insertMeal).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 1,
        source: "photo",
        estimate: expect.objectContaining({ description: "salad", calories: 400 }),
      }),
    );
    expect(deletePendingMeal).toHaveBeenCalledWith(db, 1);
    expect(sendOut).toHaveBeenCalled();
  });

  it("skips when no pending meal", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(null);

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:log",
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "log");

    expect(insertMeal).not.toHaveBeenCalled();
    expect(sendOut).toHaveBeenCalledWith(
      mockChannel,
      db,
      123,
      1,
      "telegram",
      "nothing pending to confirm",
      undefined,
    );
  });
});
