import { afterEach, describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "../src/channels/telegram";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";

const mockEnv = {
  TELEGRAM_BOT_TOKEN: "test-token",
  TELEGRAM_WEBHOOK_SECRET: "secret",
  PUBLIC_BASE_URL: "https://example.com",
} as Env;

const settings = getSettings(mockEnv);

describe("TelegramChannel.downloadPhoto", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads image with correct MIME from content-type", async () => {
    const channel = new TelegramChannel(settings, "test-token");
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("getFile")) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: "photos/file.webp" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("file/bot")) {
        return new Response(imageBytes, {
          status: 200,
          headers: { "content-type": "image/webp" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await channel.downloadPhoto("file123");
    expect(result.mime).toBe("image/webp");
    expect(result.bytes).toEqual(imageBytes);
    expect(result.bytes.byteLength).toBe(4);
  });

  it("throws on failed download status", async () => {
    const channel = new TelegramChannel(settings, "test-token");

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("getFile")) {
        return new Response(
          JSON.stringify({ ok: true, result: { file_path: "photos/file.jpg" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    await expect(channel.downloadPhoto("file123")).rejects.toThrow(
      "Telegram file download failed: 404",
    );
  });

  it("parses document images as photos", () => {
    const channel = new TelegramChannel(settings, "test-token");
    const msg = channel.parseUpdate({
      message: {
        from: { id: 42, first_name: "Test" },
        chat: { id: 42 },
        document: {
          file_id: "doc123",
          file_unique_id: "docuniq",
          mime_type: "image/png",
        },
      },
    });
    expect(msg?.photo?.fileId).toBe("doc123");
  });
});

describe("TelegramChannel message edits", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("editMessageText sends text and optional keyboard", async () => {
    const channel = new TelegramChannel(settings, "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await channel.editMessageText(99, 12, "logged <b>salad</b>", "HTML", [
      [{ label: "Log", data: "meal:log" }],
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/editMessageText"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("logged"),
      }),
    );
  });

  it("clearMessageReplyMarkup clears inline keyboard", async () => {
    const channel = new TelegramChannel(settings, "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await channel.clearMessageReplyMarkup(99, 12);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("answerCallback can include toast text", async () => {
    const channel = new TelegramChannel(settings, "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await channel.answerCallback("cb-1", { text: "skipped" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.text).toBe("skipped");
  });
});
