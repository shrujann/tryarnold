import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/client", () => ({
  dbFirst: vi.fn(),
  dbRun: vi.fn(),
  dbAll: vi.fn(),
  startOfDayInTimezone: vi.fn(),
  utcNow: vi.fn(() => "2026-07-09T00:00:00Z"),
}));

vi.mock("../src/db/messages", () => ({
  logMessage: vi.fn(),
}));

vi.mock("../src/handlers/commands", () => ({
  sendOut: vi.fn(),
}));

import { dbRun } from "../src/db/client";
import { logMessage } from "../src/db/messages";
import { sendOut } from "../src/handlers/commands";
import { handleOnboarding } from "../src/handlers/onboarding";
import {
  normalizeOnboardAction,
  nextOnboardingStep,
  stepButtons,
  stepPrompt,
  hasStartedOnboarding,
} from "../src/services/onboarding";
import type { InboundMessage, MessagingChannel } from "../src/channels/types";
import type { UserRow } from "../src/db/users";
import type { Env } from "../src/env";

const mockChannel: MessagingChannel = {
  name: "telegram",
  enabled: true,
  sendText: vi.fn(),
  sendTextWithKeyboard: vi.fn(),
  downloadPhoto: vi.fn(),
  parseUpdate: () => null,
  answerCallback: vi.fn(),
  clearMessageReplyMarkup: vi.fn(),
};

const env = {} as Env;
const db = {} as D1Database;

describe("onboarding service", () => {
  it("normalizes onboard callback tokens", () => {
    expect(normalizeOnboardAction("onboard:unit_metric")).toEqual({
      step: "unit",
      value: "metric",
    });
    expect(normalizeOnboardAction("onboard:gender_female")).toEqual({
      step: "gender",
      value: "female",
    });
    expect(normalizeOnboardAction("onboard:activity_moderate")).toEqual({
      step: "activity",
      value: "moderate",
    });
    expect(normalizeOnboardAction("meal:log")).toBeNull();
  });

  it("advances through steps in order", () => {
    expect(nextOnboardingStep("unit")).toBe("gender");
    expect(nextOnboardingStep("goal")).toBe("done");
  });

  it("provides prompts and buttons for button steps", () => {
    expect(stepPrompt("unit")).toContain("units");
    expect(stepButtons("unit")).toHaveLength(1);
    expect(stepButtons("activity")).toHaveLength(5);
    expect(stepButtons("age")).toHaveLength(0);
  });

  it("tracks whether onboarding has started", () => {
    expect(hasStartedOnboarding({ onboarding_step: null })).toBe(false);
    expect(hasStartedOnboarding({ onboarding_step: "unit" })).toBe(true);
    expect(hasStartedOnboarding({ onboarding_step: "age" })).toBe(true);
  });
});

describe("handleOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when user is already onboarded", async () => {
    const user = { id: 1, onboarded: 1 } as UserRow;
    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      text: "hello",
    };
    const handled = await handleOnboarding(env, db, mockChannel, msg, user);
    expect(handled).toBe(false);
  });

  it("handles unit selection callback", async () => {
    const user = { id: 1, onboarded: 0, onboarding_step: "unit" } as UserRow;
    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      callbackData: "onboard:unit_metric",
      callbackQueryId: "cb-1",
      callbackMessageId: 99,
    };

    const handled = await handleOnboarding(env, db, mockChannel, msg, user);
    expect(handled).toBe(true);
    expect(mockChannel.answerCallback).toHaveBeenCalledWith("cb-1");
    expect(mockChannel.clearMessageReplyMarkup).toHaveBeenCalledWith(1, 99);
    expect(dbRun).toHaveBeenCalledWith(
      db,
      expect.stringContaining("unit_preference"),
      "metric",
      "gender",
      1,
    );
    expect(mockChannel.sendTextWithKeyboard).toHaveBeenCalled();
    expect(logMessage).toHaveBeenCalled();
  });

  it("validates age text input", async () => {
    const user = { id: 1, onboarded: 0, onboarding_step: "age" } as UserRow;
    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      text: "not-a-number",
    };

    await handleOnboarding(env, db, mockChannel, msg, user);
    expect(sendOut).toHaveBeenCalledWith(
      mockChannel,
      db,
      1,
      1,
      "telegram",
      "enter a valid age between 13 and 100.",
      undefined,
    );
  });

  it("accepts valid age and advances to weight", async () => {
    const user = { id: 1, onboarded: 0, onboarding_step: "age" } as UserRow;
    const msg: InboundMessage = {
      channel: "telegram",
      externalUserId: "1",
      chatId: 1,
      text: "30",
    };

    await handleOnboarding(env, db, mockChannel, msg, user);
    expect(dbRun).toHaveBeenCalledWith(
      db,
      expect.stringContaining("age"),
      30,
      "weight",
      1,
    );
    expect(sendOut).toHaveBeenCalled();
  });
});
