import { describe, expect, it, vi, beforeEach } from "vitest";
import { macroEstimateSchema } from "../src/schemas/nutrition";
import type { Env } from "../src/env";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";
import type { PendingMealRow } from "../src/db/pending-meals";

vi.mock("../src/db/users", () => ({
  getOrCreateUser: vi.fn(),
  getDailyProgress: vi.fn(async () => ({ remaining_calories: 2000 })),
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

vi.mock("../src/db/pending-meals", async () => {
  const actual = await vi.importActual<typeof import("../src/db/pending-meals")>(
    "../src/db/pending-meals",
  );
  return {
    ...actual,
    getPendingMeal: vi.fn(),
    deletePendingMeal: vi.fn(),
    updatePendingMeal: vi.fn(),
    updatePendingMealIf: vi.fn(),
    isPendingMealExpired: vi.fn(() => false),
  };
});

vi.mock("../src/handlers/commands", () => ({
  sendOut: vi.fn(),
  handleCommand: vi.fn(async () => false),
}));

vi.mock("../src/handlers/confirmation", () => ({
  handleConfirmation: vi.fn(),
}));

vi.mock("../src/handlers/clarification", () => ({
  handleClarification: vi.fn(),
  sendMealConfirmUi: vi.fn(),
}));

vi.mock("../src/handlers/photo", () => ({
  handlePhoto: vi.fn(),
}));

vi.mock("../src/handlers/onboarding", () => ({
  handleOnboarding: vi.fn(),
}));

vi.mock("../src/agents/coach", () => ({
  runCoachAgent: vi.fn(async () => "coach reply"),
}));

vi.mock("../src/agents/meal-edit", () => ({
  applyMealEdit: vi.fn(),
}));

vi.mock("../src/services/fatsecret", () => ({
  enrichEstimateWithFatSecret: vi.fn(async (estimate) => ({
    estimate,
    fatsecretUsed: false,
  })),
  FATSECRET_ATTRIBUTION_LINE: "",
  FATSECRET_ATTRIBUTION_TELEGRAM: "",
}));

vi.mock("../src/channels/interactive", () => ({
  clearInteractiveKeyboard: vi.fn(),
}));

import { getOrCreateUser } from "../src/db/users";
import {
  getPendingMeal,
  deletePendingMeal,
  updatePendingMealIf,
  isPendingMealExpired,
} from "../src/db/pending-meals";
import { sendOut } from "../src/handlers/commands";
import { handleConfirmation } from "../src/handlers/confirmation";
import { sendMealConfirmUi } from "../src/handlers/clarification";
import { handleMealEdit } from "../src/handlers/meal-edit";
import { processMessage } from "../src/handlers/dispatcher";
import { runCoachAgent } from "../src/agents/coach";
import { applyMealEdit } from "../src/agents/meal-edit";
import { clearInteractiveKeyboard } from "../src/channels/interactive";

const testEnv = {
  OPENROUTER_API_KEY: "test-key",
  PORTION_SIZE_SMALL: "0.7",
  PORTION_SIZE_LARGE: "1.3",
  PENDING_MEAL_TTL_MINUTES: "30",
} as Env;

const db = {} as D1Database;

const user: UserRow = {
  id: 1,
  portion_multiplier: 1,
  onboarded: 1,
  timezone: "UTC",
};

const estimate = macroEstimateSchema.parse({
  description: "iced coffee",
  calories: 200,
  protein_g: 8,
  carbs_g: 15,
  fat_g: 6,
  portion_confidence: 0.8,
  food_confidence: 0.9,
  items: [
    { name: "coffee", weight_g: 200, calories: 200, protein_g: 8, carbs_g: 15, fat_g: 6 },
  ],
});

function pendingRow(phase: PendingMealRow["phase"], id = 10): PendingMealRow {
  return {
    id,
    user_id: 1,
    estimate_json: JSON.stringify(estimate),
    base_multiplier: 1,
    media_ref: "f1",
    media_unique_ref: "fu1",
    photo_caption: null,
    created_at: new Date().toISOString(),
    phase,
    ui_message_id: "55",
  };
}

function textMsg(text: string): InboundMessage {
  return {
    channel: "telegram",
    externalUserId: "123",
    chatId: 123,
    text,
  };
}

describe("processMessage meal-edit chat routing", () => {
  let channel: MessagingChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = {
      name: "telegram",
      enabled: true,
      sendText: vi.fn(),
      sendTextWithKeyboard: vi.fn(async () => null),
      answerCallback: vi.fn(),
      clearMessageReplyMarkup: vi.fn(),
    };
    vi.mocked(getOrCreateUser).mockResolvedValue(user);
    vi.mocked(isPendingMealExpired).mockReturnValue(false);
  });

  it("routes free text during confirm to meal edit, not coach", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow("confirm"));
    vi.mocked(updatePendingMealIf).mockResolvedValue(true);
    vi.mocked(applyMealEdit).mockResolvedValue(estimate);

    await processMessage(testEnv, db, channel, textMsg("add cream please"));

    expect(applyMealEdit).toHaveBeenCalled();
    expect(runCoachAgent).not.toHaveBeenCalled();
    expect(handleConfirmation).not.toHaveBeenCalled();
  });

  it("routes free text during clarifying_toggle to meal edit", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow("clarifying_toggle"));
    vi.mocked(updatePendingMealIf).mockResolvedValue(true);
    vi.mocked(applyMealEdit).mockResolvedValue(estimate);

    await processMessage(testEnv, db, channel, textMsg("less ice"));

    expect(applyMealEdit).toHaveBeenCalled();
    expect(runCoachAgent).not.toHaveBeenCalled();
  });

  it("keeps log alias on confirmation path", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow("confirm"));

    await processMessage(testEnv, db, channel, textMsg("log"));

    expect(handleConfirmation).toHaveBeenCalledWith(
      testEnv,
      db,
      channel,
      expect.objectContaining({ text: "log" }),
      user,
      "log",
    );
    expect(applyMealEdit).not.toHaveBeenCalled();
    expect(runCoachAgent).not.toHaveBeenCalled();
  });

  it("uses coach when no pending meal exists", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(null);

    await processMessage(testEnv, db, channel, textMsg("how am I doing today?"));

    expect(runCoachAgent).toHaveBeenCalledWith(testEnv, db, user, "how am I doing today?");
    expect(applyMealEdit).not.toHaveBeenCalled();
  });

  it("expires pending meal on free text and does not coach", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow("confirm"));
    vi.mocked(isPendingMealExpired).mockReturnValue(true);

    await processMessage(testEnv, db, channel, textMsg("add sugar"));

    expect(deletePendingMeal).toHaveBeenCalledWith(db, 1);
    expect(sendOut).toHaveBeenCalledWith(
      channel,
      db,
      123,
      1,
      "telegram",
      "that meal estimate expired. send the photo again.",
      undefined,
    );
    expect(applyMealEdit).not.toHaveBeenCalled();
    expect(runCoachAgent).not.toHaveBeenCalled();
  });
});

describe("handleMealEdit", () => {
  let channel: MessagingChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = {
      name: "telegram",
      enabled: true,
      sendText: vi.fn(),
      sendTextWithKeyboard: vi.fn(async () => null),
      clearMessageReplyMarkup: vi.fn(),
    };
    vi.mocked(isPendingMealExpired).mockReturnValue(false);
    vi.mocked(updatePendingMealIf).mockResolvedValue(true);
    vi.mocked(applyMealEdit).mockResolvedValue({
      ...estimate,
      description: "iced coffee with cream",
      calories: 250,
    });
  });

  it("moves confirm pending into editing, applies edit, returns to confirm UI", async () => {
    const pending = pendingRow("confirm", 10);
    vi.mocked(getPendingMeal)
      .mockResolvedValueOnce({ ...pending, phase: "editing" })
      .mockResolvedValueOnce({ ...pending, phase: "confirm", ui_message_id: "55" });

    await handleMealEdit(testEnv, db, channel, textMsg("add cream"), user, pending);

    expect(clearInteractiveKeyboard).toHaveBeenCalledWith(channel, 123, "55");
    expect(updatePendingMealIf).toHaveBeenCalledWith(db, 1, 10, { phase: "editing" });
    expect(applyMealEdit).toHaveBeenCalledWith(
      testEnv,
      expect.objectContaining({ description: "iced coffee" }),
      "add cream",
    );
    expect(updatePendingMealIf).toHaveBeenCalledWith(
      db,
      1,
      10,
      expect.objectContaining({
        phase: "confirm",
        fatsecretPrefetch: null,
      }),
    );
    expect(sendMealConfirmUi).toHaveBeenCalled();
  });

  it("supports a second free-text edit while still on the same pending meal", async () => {
    const pending = pendingRow("confirm", 10);
    vi.mocked(getPendingMeal).mockResolvedValue({ ...pending, phase: "editing" });

    await handleMealEdit(testEnv, db, channel, textMsg("add cream"), user, pending);
    await handleMealEdit(
      testEnv,
      db,
      channel,
      textMsg("make it less sweet"),
      user,
      { ...pending, phase: "confirm" },
    );

    expect(applyMealEdit).toHaveBeenCalledTimes(2);
    expect(applyMealEdit).toHaveBeenLastCalledWith(
      testEnv,
      expect.anything(),
      "make it less sweet",
    );
  });

  it("does not overwrite when pending meal id was replaced during LLM edit", async () => {
    const pending = pendingRow("editing", 10);
    vi.mocked(updatePendingMealIf).mockResolvedValue(false);

    await handleMealEdit(testEnv, db, channel, textMsg("add cream"), user, pending);

    expect(sendMealConfirmUi).not.toHaveBeenCalled();
    expect(sendOut).toHaveBeenCalledWith(
      channel,
      db,
      123,
      1,
      "telegram",
      "that meal was replaced by a newer photo. send your change again if needed.",
      undefined,
    );
  });
});
