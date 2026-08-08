import { describe, expect, it } from "vitest";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";
import {
  buildMediaProxyUrl,
  signMediaToken,
  verifyMediaToken,
} from "../src/services/media-token";

const settings = getSettings({
  PUBLIC_BASE_URL: "https://example.com",
  TELEGRAM_WEBHOOK_SECRET: "test-secret",
} as Env);

describe("media-token", () => {
  it("signs and verifies a media token", async () => {
    const token = await signMediaToken(settings, "line", "msg-123");
    const payload = await verifyMediaToken(settings, token);
    expect(payload).toEqual(
      expect.objectContaining({
        channel: "line",
        mediaRef: "msg-123",
      }),
    );
  });

  it("rejects tampered tokens", async () => {
    const token = await signMediaToken(settings, "line", "msg-123");
    const [body] = token.split(".");
    await expect(verifyMediaToken(settings, `${body}.deadbeef`)).resolves.toBeNull();
  });

  it("builds a proxy URL under PUBLIC_BASE_URL", async () => {
    const url = await buildMediaProxyUrl(settings, "line", "msg-123");
    expect(url.startsWith("https://example.com/media/")).toBe(true);
  });
});
