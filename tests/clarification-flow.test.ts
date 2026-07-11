import { describe, expect, it, vi, beforeEach } from "vitest";
import { macroEstimateSchema } from "../src/schemas/nutrition";
import type { Env } from "../src/env";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";

const fetchOrder: string[] = [];

vi.mock("../src/db/pending-meals", () => ({
  insertPendingMeal: vi.fn(async () => {
    fetchOrder.push("insert");
  }),
  updatePendingMeal: vi.fn(async () => {
    fetchOrder.push("update");
  }),
  getPendingMeal: vi.fn(),
}));

vi.mock("../src/services/fatsecret", () => ({
  fetchClarifyNutritionCache: vi.fn(async () => {
    fetchOrder.push("fetch");
    return {
      visibleItems: [],
      addOns: {},
      assumptions: [],
      fatsecretUsed: true,
    };
  }),
  parseFatSecretPrefetch: vi.fn(),
  assembleMealFromPrefetchCache: vi.fn(),
  FATSECRET_ATTRIBUTION_LINE: "",
  FATSECRET_ATTRIBUTION_TELEGRAM: "",
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

vi.mock("../src/db/users", () => ({
  getDailyProgress: vi.fn(async () => ({ remaining_calories: 2000 })),
}));

import { insertPendingMeal, updatePendingMeal } from "../src/db/pending-meals";
import { fetchClarifyNutritionCache } from "../src/services/fatsecret";
import { startClarifyFlowFromVision } from "../src/handlers/clarification";

const testEnv = {
  FATSECRET_CONSUMER_KEY: "key",
  FATSECRET_CONSUMER_SECRET: "secret",
} as Env;

const draft = macroEstimateSchema.parse({
  description: "iced coffee",
  calories: 200,
  protein_g: 8,
  carbs_g: 15,
  fat_g: 6,
  portion_confidence: 0.8,
  food_confidence: 0.9,
  portion: { container_type: "cup", container_volume_ml: 400, fill_fraction: 0.7, notes: null },
  items: [
    { name: "whole milk", weight_g: 180, calories: 100, protein_g: 5, carbs_g: 8, fat_g: 4 },
    { name: "coffee", weight_g: 100, calories: 100, protein_g: 3, carbs_g: 7, fat_g: 2 },
  ],
});

const user: UserRow = { id: 1, portion_multiplier: 1, onboarded: 1 };

describe("startClarifyFlowFromVision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchOrder.length = 0;
  });

  it("replies on LINE before fetch and fetches nutrition before toggle UI", async () => {
    const lineChannel: MessagingChannel = {
      name: "line",
      enabled: true,
      sendText: vi.fn(async () => {}),
      sendTextWithKeyboard: vi.fn(async () => null),
    };

    const msg: InboundMessage = {
      channel: "line",
      externalUserId: "U1",
      chatId: "U1",
      replyToken: "line-reply-token",
      photo: { fileId: "p1", fileUniqueId: "pu1" },
    };

    await startClarifyFlowFromVision(
      testEnv,
      {} as D1Database,
      lineChannel,
      msg,
      user,
      draft,
      { toggles: [{ id: "added_sugar", label: "Sugar" }], exclusive: null },
      1,
    );

    expect(lineChannel.sendText).toHaveBeenCalledWith(
      "U1",
      "Analyzing image…",
      "line-reply-token",
    );
    expect(fetchOrder).toEqual(["insert", "fetch", "update"]);
    expect(fetchClarifyNutritionCache).toHaveBeenCalled();
    expect(lineChannel.sendTextWithKeyboard).toHaveBeenCalled();
    expect(insertPendingMeal).toHaveBeenCalledBefore(fetchClarifyNutritionCache);
    expect(fetchClarifyNutritionCache).toHaveBeenCalledBefore(
      lineChannel.sendTextWithKeyboard as ReturnType<typeof vi.fn>,
    );
  });

  it("deletes Telegram analyzing message before showing toggle UI", async () => {
    const telegramChannel: MessagingChannel = {
      name: "telegram",
      enabled: true,
      sendText: vi.fn(async () => {}),
      sendTextWithKeyboard: vi.fn(async () => 42),
      sendTextReturningId: vi.fn(async () => 1001),
      deleteMessage: vi.fn(async () => {}),
    };

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "123",
      chatId: 123,
      photo: { fileId: "p1", fileUniqueId: "pu1" },
    };

    await startClarifyFlowFromVision(
      testEnv,
      {} as D1Database,
      telegramChannel,
      msg,
      user,
      draft,
      { toggles: [{ id: "added_sugar", label: "Sugar" }], exclusive: null },
      1,
    );

    expect(telegramChannel.sendTextReturningId).toHaveBeenCalledWith(
      123,
      "Analyzing image…",
    );
    expect(telegramChannel.deleteMessage).toHaveBeenCalledWith(123, 1001);
    expect(fetchClarifyNutritionCache).toHaveBeenCalled();
    expect(updatePendingMeal).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ fatsecretPrefetch: expect.any(Object) }),
    );
  });
});
