import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LineChannel,
  buildFlexFooterContents,
  buildQuickReplyItems,
  verifyLineSignature,
} from "../src/channels/line";
import { stepButtons } from "../src/services/onboarding";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    PUBLIC_BASE_URL: "https://example.workers.dev",
    LINE_CHANNEL_ACCESS_TOKEN: "line-token",
    LINE_CHANNEL_SECRET: "line-secret",
    ...overrides,
  } as Env;
}

describe("verifyLineSignature", () => {
  it("validates correct HMAC signature", async () => {
    const secret = "test-channel-secret";
    const body = '{"events":[]}';

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

    const valid = await verifyLineSignature(body, signature, secret);
    expect(valid).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const valid = await verifyLineSignature('{"events":[]}', "bad-sig", "secret");
    expect(valid).toBe(false);
  });
});

describe("buildQuickReplyItems", () => {
  it("flattens button rows left-to-right", () => {
    const buttons = [
      [
        { label: "Log", data: "meal:log" },
        { label: "Edit", data: "meal:edit" },
      ],
      [{ label: "Skip", data: "meal:skip" }],
    ];

    const items = buildQuickReplyItems(buttons) as Array<{
      action: { label: string; data: string; displayText: string; type: string };
    }>;

    expect(items).toHaveLength(3);
    expect(items[0]!.action).toMatchObject({
      type: "postback",
      label: "Log",
      data: "meal:log",
      displayText: "Log",
    });
    expect(items[2]!.action.data).toBe("meal:skip");
  });

  it("caps at 13 items and truncates labels to 20 chars", () => {
    const buttons = Array.from({ length: 15 }, (_, i) => [
      { label: `Button number ${i + 1} extra long`, data: `onboard:item_${i}` },
    ]);

    const items = buildQuickReplyItems(buttons) as Array<{
      action: { label: string; data: string };
    }>;

    expect(items).toHaveLength(13);
    expect(items[0]!.action.label.length).toBeLessThanOrEqual(20);
    expect(items[0]!.action.label).toBe("Button number 1 extr");
    expect(items[12]!.action.data).toBe("onboard:item_12");
  });

  it("fits onboarding activity step (5 buttons)", () => {
    const activityButtons = stepButtons("activity");
    const items = buildQuickReplyItems(activityButtons);
    expect(items).toHaveLength(5);
  });
});

describe("LineChannel.sendTextWithKeyboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends plain text with quickReply, not flex", async () => {
    const channel = new LineChannel(getSettings(testEnv()), "line-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await channel.sendTextWithKeyboard(
      "U123",
      "confirm meal",
      [[{ label: "Log", data: "meal:log" }]],
      "reply-token",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/reply",
      expect.objectContaining({ method: "POST" }),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].type).toBe("text");
    expect(body.messages[0].text).toBe("confirm meal");
    expect(body.messages[0].quickReply.items).toHaveLength(1);
    expect(body.messages[0].quickReply.items[0].action.data).toBe("meal:log");
    expect(body.replyToken).toBe("reply-token");
  });
});

describe("buildFlexFooterContents", () => {
  it("creates one horizontal box per button row", () => {
    const buttons = [
      [
        { label: "Small", data: "meal:size_s" },
        { label: "Medium", data: "meal:size_m" },
        { label: "Large", data: "meal:size_l" },
      ],
      [{ label: "Skip", data: "meal:skip" }],
    ];

    const footer = buildFlexFooterContents(buttons);
    expect(footer).toHaveLength(2);
    expect(footer[0]).toMatchObject({ type: "box", layout: "horizontal" });
    expect(footer[1]).toMatchObject({ type: "box", layout: "horizontal" });
    expect((footer[0] as { contents: unknown[] }).contents).toHaveLength(3);
    expect((footer[1] as { contents: unknown[] }).contents).toHaveLength(1);
  });
});

describe("LineChannel.parseUpdate", () => {
  const channel = new LineChannel(getSettings(testEnv()));

  it("parses text messages", () => {
    const messages = channel.parseUpdate({
      events: [
        {
          type: "message",
          replyToken: "reply-1",
          source: { userId: "U123" },
          message: { type: "text", id: "m1", text: "hello coach" },
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      channel: "line",
      externalUserId: "U123",
      chatId: "U123",
      text: "hello coach",
      replyToken: "reply-1",
    });
  });

  it("parses image messages", () => {
    const messages = channel.parseUpdate({
      events: [
        {
          type: "message",
          replyToken: "reply-2",
          source: { userId: "U456" },
          message: { type: "image", id: "img-99" },
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      channel: "line",
      externalUserId: "U456",
      photo: {
        fileId: "img-99",
        fileUniqueId: "img-99",
        messageId: "img-99",
      },
    });
  });

  it("parses postback events", () => {
    const messages = channel.parseUpdate({
      events: [
        {
          type: "postback",
          replyToken: "reply-3",
          source: { userId: "U789" },
          postback: { data: "meal:log" },
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      channel: "line",
      callbackData: "meal:log",
      text: "meal:log",
      replyToken: "reply-3",
    });
  });

  it("parses follow events", () => {
    const messages = channel.parseUpdate({
      events: [
        {
          type: "follow",
          replyToken: "reply-4",
          source: { userId: "Unew" },
        },
      ],
    });

    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      channel: "line",
      externalUserId: "Unew",
      isFollow: true,
      replyToken: "reply-4",
    });
  });

  it("ignores unsupported event types", () => {
    const messages = channel.parseUpdate({
      events: [
        { type: "unfollow", source: { userId: "U1" } },
        {
          type: "message",
          source: { userId: "U2" },
          message: { type: "sticker", id: "s1" },
        },
      ],
    });

    expect(messages).toBeNull();
  });
});
