import { describe, expect, it, vi, beforeEach } from "vitest";
import { macroEstimateSchema } from "../src/schemas/nutrition";

vi.mock("../src/db/pending-meals", () => ({
  getPendingMeal: vi.fn(),
  deletePendingMeal: vi.fn(),
  updatePendingMeal: vi.fn(),
  isPendingMealExpired: vi.fn(() => false),
  pendingPhase: vi.fn(() => "confirm"),
  parseClarifyPlan: vi.fn(),
  parseSelectedToggleIds: vi.fn(() => []),
}));

vi.mock("../src/db/meals", () => ({
  insertMeal: vi.fn(),
}));

vi.mock("../src/db/users", () => ({
  updatePortionMultiplier: vi.fn(),
  getDailyProgress: vi.fn(() => Promise.resolve({ remaining_calories: 2000 })),
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

vi.mock("../src/handlers/commands", () => ({
  sendOut: vi.fn(),
}));

vi.mock("../src/services/fatsecret", () => ({
  fetchClarifyNutritionCache: vi.fn(),
  parseFatSecretPrefetch: vi.fn((row: { fatsecret_prefetch_json?: string | null }) => {
    if (!row.fatsecret_prefetch_json) return null;
    return JSON.parse(row.fatsecret_prefetch_json);
  }),
  assembleMealFromPrefetchCache: vi.fn((_draft, _selected, _exclusive, cache) => ({
    estimate: {
      description: "iced latte",
      calories: 136,
      protein_g: 6,
      carbs_g: 14,
      fat_g: 7,
      assumptions: cache?.assumptions ?? ["fatsecret: enriched"],
      items: [...(cache?.visibleItems ?? []), ...( _selected?.length ? [cache?.addOns?.added_sugar] : [])].filter(Boolean),
    },
    fatsecretUsed: true,
  })),
  enrichEstimateWithFatSecret: vi.fn(async (estimate) => ({
    estimate: { ...estimate, assumptions: [...(estimate.assumptions ?? []), "fatsecret: enriched"] },
    fatsecretUsed: true,
  })),
  FATSECRET_ATTRIBUTION_LINE: "\n\nPowered by fatsecret",
  FATSECRET_ATTRIBUTION_TELEGRAM: "\n\nPowered by fatsecret",
  hasFatSecretAssumption: vi.fn((assumptions: string[]) =>
    assumptions.some((a) => a.startsWith("fatsecret:")),
  ),
}));

import {
  getPendingMeal,
  deletePendingMeal,
  updatePendingMeal,
  pendingPhase,
  parseClarifyPlan,
  parseSelectedToggleIds,
} from "../src/db/pending-meals";
import { insertMeal } from "../src/db/meals";
import { handleConfirmation } from "../src/handlers/confirmation";
import { handleClarification, finalizePendingMeal } from "../src/handlers/clarification";
import {
  assembleMealFromPrefetchCache,
} from "../src/services/fatsecret";
import { sendOut } from "../src/handlers/commands";
import type { Env } from "../src/env";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";

const testEnv = {
  PENDING_MEAL_TTL_MINUTES: "30",
  PORTION_SIZE_SMALL: "0.7",
  PORTION_SIZE_LARGE: "1.3",
  FATSECRET_CONSUMER_KEY: "key",
  FATSECRET_CONSUMER_SECRET: "secret",
} as Env;

const mockChannel: MessagingChannel = {
  name: "telegram",
  enabled: true,
  sendText: vi.fn(),
  sendTextWithKeyboard: vi.fn(async () => 42),
  sendPhoto: vi.fn(),
  downloadPhoto: vi.fn(),
  parseUpdate: () => null,
  answerCallback: vi.fn(),
  editMessageReplyMarkup: vi.fn(),
  editMessageText: vi.fn(),
  clearMessageReplyMarkup: vi.fn(),
  deleteMessage: vi.fn(),
  sendTextReturningId: vi.fn(async () => 999),
};

const user: UserRow = { id: 1, portion_multiplier: 1, onboarded: 1 };
const db = {} as D1Database;

const visionDraft = macroEstimateSchema.parse({
  description: "iced latte",
  calories: 116,
  protein_g: 6,
  carbs_g: 9,
  fat_g: 5,
  portion_confidence: 0.8,
  food_confidence: 0.9,
  portion: { container_type: "cup", container_volume_ml: 400, fill_fraction: 0.75, notes: null },
  items: [
    {
      name: "whole milk",
      weight_g: 195,
      volume_ml: 195,
      calories: 115,
      protein_g: 6,
      carbs_g: 9,
      fat_g: 5,
    },
    {
      name: "brewed coffee",
      weight_g: 75,
      volume_ml: 75,
      calories: 1,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    },
  ],
});

const nutritionCache = {
  visibleItems: [
    { name: "whole milk", calories: 115, protein_g: 6, carbs_g: 9, fat_g: 5 },
    { name: "brewed coffee", calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0 },
  ],
  addOns: {
    added_sugar: { name: "sugar", calories: 20, protein_g: 0, carbs_g: 5, fat_g: 0 },
  },
  assumptions: ["fatsecret: enriched"],
  fatsecretUsed: true,
};

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 1,
    estimate_json: JSON.stringify(visionDraft),
    base_multiplier: 1,
    media_ref: "f1",
    media_unique_ref: "fu1",
    photo_caption: null,
    created_at: new Date().toISOString(),
    phase: "clarifying_toggle",
    clarify_plan_json: JSON.stringify({
      toggles: [{ id: "added_sugar", label: "Sugar" }],
      exclusive: null,
      introText: "Anything else?",
    }),
    clarify_selected_json: "[]",
    clarify_exclusive_choice: null,
    fatsecret_prefetch_json: JSON.stringify(nutritionCache),
    ...overrides,
  };
}

describe("handleConfirmation D1 flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pendingPhase).mockReturnValue("confirm");
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
      estimate_json: JSON.stringify({
        ...estimate,
        assumptions: ["fatsecret: test food (1 serving)"],
      }),
      base_multiplier: 1,
      media_ref: "f1",
      media_unique_ref: "fu1",
      photo_caption: null,
      created_at: new Date().toISOString(),
      phase: "confirm",
      ui_message_id: "100",
    });

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:log",
      callbackQueryId: "cb-1",
      callbackMessageId: 100,
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "log");

    expect(insertMeal).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 1,
        source: "photo",
        estimate: expect.objectContaining({ description: "salad", calories: 400 }),
        mediaRef: "f1",
      }),
    );
    expect(deletePendingMeal).toHaveBeenCalledWith(db, 1);
    expect(mockChannel.deleteMessage).toHaveBeenCalledWith(123, 100);
    expect(mockChannel.sendPhoto).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        fileId: "f1",
        caption: expect.stringContaining("logged <b>salad</b> — 400 kcal"),
        parseMode: "HTML",
      }),
    );
    expect(mockChannel.sendPhoto).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        caption: expect.stringContaining("Powered by fatsecret"),
      }),
    );
    expect(mockChannel.editMessageText).not.toHaveBeenCalled();
    expect(mockChannel.sendText).not.toHaveBeenCalled();
    expect(sendOut).not.toHaveBeenCalled();
  });

  it("clears keyboard on skip without sending a new message on telegram", async () => {
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
      phase: "confirm",
      ui_message_id: "100",
    });

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:skip",
      callbackQueryId: "cb-skip",
      callbackMessageId: 100,
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "skip");

    expect(mockChannel.answerCallback).toHaveBeenCalledWith("cb-skip", { text: "skipped" });
    expect(mockChannel.clearMessageReplyMarkup).toHaveBeenCalledWith(123, 100);
    expect(sendOut).not.toHaveBeenCalled();
    expect(deletePendingMeal).toHaveBeenCalledWith(db, 1);
  });

  it("clears keyboard on edit and sends edit prompt", async () => {
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
      phase: "confirm",
      ui_message_id: "100",
    });

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:edit",
      callbackQueryId: "cb-edit",
      callbackMessageId: 100,
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "edit");

    expect(mockChannel.clearMessageReplyMarkup).toHaveBeenCalledWith(123, 100);
    expect(updatePendingMeal).toHaveBeenCalledWith(db, 1, { phase: "editing" });
    expect(sendOut).toHaveBeenCalledWith(
      mockChannel,
      db,
      123,
      1,
      "telegram",
      "what would you like to change?",
      undefined,
    );
  });

  it("logs meal on LINE with photo and macro caption", async () => {
    const lineChannel: MessagingChannel = {
      ...mockChannel,
      name: "line",
      sendText: vi.fn(),
      sendPhoto: vi.fn(),
    };

    const estimate = macroEstimateSchema.parse({
      description: "salad",
      calories: 400,
      protein_g: 20,
      carbs_g: 30,
      fat_g: 15,
      portion_confidence: 0.8,
      food_confidence: 0.9,
      items: [],
      assumptions: ["fatsecret: test food (1 serving)"],
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
      phase: "confirm",
    });

    const msg: InboundMessage = {
      channel: "line",
      externalUserId: "U123",
      chatId: "U123",
      callbackData: "meal:log",
      replyToken: "reply-1",
    };

    await handleConfirmation(testEnv, db, lineChannel, msg, user, "log");

    expect(lineChannel.sendPhoto).toHaveBeenCalledTimes(1);
    expect(lineChannel.sendPhoto).toHaveBeenCalledWith(
      "U123",
      expect.objectContaining({
        imageUrl: expect.stringContaining("/media/"),
        caption: expect.stringMatching(/logged salad — 400 kcal.*Powered by fatsecret/s),
        replyToken: "reply-1",
      }),
    );
    expect(lineChannel.sendText).not.toHaveBeenCalled();
    expect(sendOut).not.toHaveBeenCalled();
  });

  it("skips silently on LINE without extra message", async () => {
    const lineChannel: MessagingChannel = {
      ...mockChannel,
      name: "line",
    };

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
      phase: "confirm",
    });

    const msg: InboundMessage = {
      channel: "line",
      externalUserId: "U123",
      chatId: "U123",
      callbackData: "meal:skip",
      replyToken: "reply-2",
    };

    await handleConfirmation(testEnv, db, lineChannel, msg, user, "skip");

    expect(sendOut).not.toHaveBeenCalled();
    expect(deletePendingMeal).toHaveBeenCalledWith(db, 1);
  });

  it("inserts meal and clears pending on log action without fatsecret", async () => {
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
      phase: "confirm",
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
    expect(mockChannel.sendPhoto).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        fileId: "f1",
        caption: expect.stringContaining("logged <b>salad</b> — 400 kcal"),
      }),
    );
    expect(mockChannel.sendText).not.toHaveBeenCalled();
    expect(sendOut).not.toHaveBeenCalled();
  });

  it("falls back to text edit when meal has no photo", async () => {
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
      media_ref: null,
      media_unique_ref: null,
      photo_caption: null,
      created_at: new Date().toISOString(),
      phase: "confirm",
      ui_message_id: "100",
    });

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:log",
      callbackQueryId: "cb-1",
      callbackMessageId: 100,
    };

    await handleConfirmation(testEnv, db, mockChannel, msg, user, "log");

    expect(mockChannel.sendPhoto).not.toHaveBeenCalled();
    expect(mockChannel.editMessageText).toHaveBeenCalledWith(
      123,
      100,
      expect.stringContaining("logged <b>salad</b> — 400 kcal"),
      "HTML",
    );
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

  it("blocks log when still clarifying", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow() as never);
    vi.mocked(pendingPhase).mockReturnValue("clarifying_toggle");

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
      "finish the current step first.",
      undefined,
    );
  });
});

describe("clarification → calculate → confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseSelectedToggleIds).mockReturnValue(["added_sugar"]);
    vi.mocked(pendingPhase).mockReturnValue("clarifying_toggle");
  });

  it("enriches merged draft on calculate", async () => {
    const pending = pendingRow({
      phase: "clarifying_toggle",
      clarify_selected_json: '["added_sugar"]',
      ui_message_id: "55",
    });
    vi.mocked(getPendingMeal).mockResolvedValue(pending as never);

    await finalizePendingMeal(
      testEnv,
      db,
      mockChannel,
      123,
      user,
      pending as never,
    );

    expect(assembleMealFromPrefetchCache).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ name: "whole milk" }),
        ]),
      }),
      ["added_sugar"],
      null,
      expect.objectContaining({
        visibleItems: expect.any(Array),
        addOns: expect.objectContaining({ added_sugar: expect.any(Object) }),
      }),
    );
    expect(updatePendingMeal).toHaveBeenCalledWith(
      db,
      1,
      expect.objectContaining({ phase: "confirm" }),
    );
    expect(mockChannel.editMessageText).toHaveBeenCalledWith(
      123,
      "55",
      expect.stringContaining("iced latte"),
      "HTML",
      expect.any(Array),
    );
    expect(mockChannel.sendTextWithKeyboard).not.toHaveBeenCalled();
  });

  it("omits fatsecret attribution when nutrition cache is missing", async () => {
    const pending = pendingRow({
      phase: "clarifying_toggle",
      clarify_selected_json: "[]",
      ui_message_id: "55",
      fatsecret_prefetch_json: null,
    });
    vi.mocked(getPendingMeal).mockResolvedValue(pending as never);
    vi.mocked(parseSelectedToggleIds).mockReturnValue([]);

    await finalizePendingMeal(
      testEnv,
      db,
      mockChannel,
      123,
      user,
      pending as never,
    );

    expect(assembleMealFromPrefetchCache).not.toHaveBeenCalled();
    expect(mockChannel.editMessageText).toHaveBeenCalledWith(
      123,
      "55",
      expect.not.stringMatching(/fatsecret/i),
      "HTML",
      expect.any(Array),
    );
  });

  it("routes toggle done to finalize when no exclusive step", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow() as never);

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:clarify:done",
      callbackQueryId: "cb-2",
    };

    await handleClarification(testEnv, db, mockChannel, msg, user, {
      type: "clarify_done",
    });

    expect(assembleMealFromPrefetchCache).toHaveBeenCalled();
    expect(mockChannel.sendTextWithKeyboard).toHaveBeenCalled();
  });

  it("clears telegram keyboard when calculate advances phase", async () => {
    vi.mocked(getPendingMeal).mockResolvedValue(
      pendingRow({ ui_message_id: "77" }) as never,
    );

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      callbackData: "meal:clarify:done",
      callbackQueryId: "cb-3",
      callbackMessageId: 77,
    };

    await handleClarification(testEnv, db, mockChannel, msg, user, {
      type: "clarify_done",
    });

    expect(mockChannel.clearMessageReplyMarkup).toHaveBeenCalledWith(123, 77);
  });

  it("sends LINE toggle UI via keyboard helper", async () => {
    const lineChannel: MessagingChannel = {
      ...mockChannel,
      name: "line",
      sendTextWithKeyboard: vi.fn(async () => null),
    };

    vi.mocked(getPendingMeal).mockResolvedValue(pendingRow() as never);
    vi.mocked(parseClarifyPlan).mockReturnValue({
      toggles: [{ id: "added_sugar", label: "Sugar" }],
      exclusive: null,
      introText: "Anything else?",
    });
    vi.mocked(parseSelectedToggleIds).mockReturnValue([]);

    const msg: InboundMessage = {
      channel: "line",
      externalUserId: "U123",
      chatId: "U123",
      callbackData: "meal:toggle:added_sugar",
      replyToken: "reply-toggle",
    };

    await handleClarification(testEnv, db, lineChannel, msg, user, {
      type: "toggle",
      id: "added_sugar",
    });

    expect(lineChannel.sendTextWithKeyboard).toHaveBeenCalledWith(
      "U123",
      expect.any(String),
      expect.any(Array),
      "reply-toggle",
      undefined,
    );
  });
});
