import { describe, expect, it } from "vitest";
import {
  LineChannel,
  buildFlexFooterContents,
  verifyLineSignature,
} from "../src/channels/line";
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
