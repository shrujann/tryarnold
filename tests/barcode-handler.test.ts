/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";

vi.mock("../src/db/pending-meals", () => ({
  insertPendingMeal: vi.fn(),
}));

vi.mock("../src/handlers/commands", () => ({
  sendOut: vi.fn(),
}));

vi.mock("../src/handlers/clarification", () => ({
  sendMealConfirmUi: vi.fn(),
}));

vi.mock("../src/services/fatsecret", () => ({
  findFoodByBarcode: vi.fn(),
  estimateFromBarcodeFood: vi.fn(),
}));

import { insertPendingMeal } from "../src/db/pending-meals";
import { sendOut } from "../src/handlers/commands";
import { sendMealConfirmUi } from "../src/handlers/clarification";
import { handleBarcodeLookup } from "../src/handlers/barcode";
import { estimateFromBarcodeFood, findFoodByBarcode } from "../src/services/fatsecret";

const testEnv = {
  FATSECRET_CONSUMER_KEY: "key",
  FATSECRET_CONSUMER_SECRET: "secret",
} as Env;

const db = {} as D1Database;
const user: UserRow = { id: 1, onboarded: 1, portion_multiplier: 1 };

describe("handleBarcodeLookup", () => {
  let channel: MessagingChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = {
      name: "telegram",
      enabled: true,
      sendText: vi.fn(),
      sendTextWithKeyboard: vi.fn(async () => null),
    };
  });

  it("stores pending meal and shows confirm UI on success", async () => {
    const estimate = {
      description: "Brand Soda",
      calories: 140,
      protein_g: 0,
      carbs_g: 39,
      fat_g: 0,
      items: [{ name: "Brand Soda", weight_g: 0, calories: 140, protein_g: 0, carbs_g: 39, fat_g: 0 }],
      assumptions: ["fatsecret: Brand Soda (1 can)", "barcode: 0888123456789"],
      food_confidence: 0.95,
      portion_confidence: 0.9,
      confidence: 0.9,
    };
    vi.mocked(findFoodByBarcode).mockResolvedValue({
      food_id: "1",
      food_name: "Soda",
      brand_name: "Brand",
      servings: [],
      images: [],
      subCategories: [],
    });
    vi.mocked(estimateFromBarcodeFood).mockReturnValue(estimate as never);

    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      text: "0888123456789",
    };

    await handleBarcodeLookup(testEnv, db, channel, msg, user, "0888123456789");

    expect(insertPendingMeal).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: 1,
        phase: "confirm",
        estimate,
      }),
    );
    expect(sendMealConfirmUi).toHaveBeenCalled();
  });

  it("tells the user when barcode is not found", async () => {
    vi.mocked(findFoodByBarcode).mockResolvedValue(null);
    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      text: "/barcode 0000000000000",
    };

    await handleBarcodeLookup(testEnv, db, channel, msg, user, "0000000000000");

    expect(sendOut).toHaveBeenCalledWith(
      channel,
      db,
      1,
      1,
      "telegram",
      expect.stringContaining("couldn't find barcode"),
      undefined,
    );
    expect(insertPendingMeal).not.toHaveBeenCalled();
  });
});
