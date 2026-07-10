import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Env } from "../src/env";
import { verifyLineSignature } from "../src/channels/line";

vi.mock("../src/handlers/dispatcher", () => ({
  processTelegramUpdate: vi.fn().mockResolvedValue(undefined),
  processLineWebhook: vi.fn().mockResolvedValue(undefined),
}));

import worker from "../src/index";
import { processLineWebhook, processTelegramUpdate } from "../src/handlers/dispatcher";

const testEnv = {
  DB: {} as D1Database,
  APP_NAME: "tryarnold",
  APP_RUNTIME: "worker",
  PUBLIC_BASE_URL: "https://example.com",
  TELEGRAM_WEBHOOK_SECRET: "test-telegram-secret",
  LINE_CHANNEL_SECRET: "test-line-secret",
  TELEGRAM_BOT_URL: "https://t.me/tryarnold_bot",
  LINE_ADD_URL: "https://line.me/R/ti/p/@386edctb",
} as Env;

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

function fetchWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://example.com${path}`, init), testEnv, ctx);
}

describe("worker HTTP routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /healthz returns ok status", async () => {
    const response = await fetchWorker("/healthz");
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "ok",
      app: "tryarnold",
      runtime: "worker",
      memory_backend: "d1-context",
    });
    expect(body).toHaveProperty("telegram_enabled");
    expect(body).toHaveProperty("line_enabled");
  });

  it("POST /telegram/webhook/ping returns pong", async () => {
    const response = await fetchWorker("/telegram/webhook/ping", { method: "POST" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, ping: true });
  });

  it("POST /telegram/webhook rejects invalid secret", async () => {
    const response = await fetchWorker("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong-secret",
      },
      body: JSON.stringify({ update_id: 1 }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      detail: "invalid secret token",
    });
    expect(processTelegramUpdate).not.toHaveBeenCalled();
  });

  it("POST /telegram/webhook accepts valid secret and dispatches update", async () => {
    const update = { update_id: 1, message: { text: "hi" } };
    const response = await fetchWorker("/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "test-telegram-secret",
      },
      body: JSON.stringify(update),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(processTelegramUpdate).toHaveBeenCalledOnce();
  });

  it("POST /line/webhook rejects invalid signature", async () => {
    const body = JSON.stringify({ events: [] });
    const response = await fetchWorker("/line/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": "invalid",
      },
      body,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      detail: "invalid signature",
    });
    expect(processLineWebhook).not.toHaveBeenCalled();
  });

  it("POST /line/webhook accepts valid signature and schedules processing", async () => {
    const body = JSON.stringify({ events: [] });
    const secret = "test-line-secret";
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

    expect(await verifyLineSignature(body, signature, secret)).toBe(true);

    const response = await fetchWorker("/line/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-line-signature": signature,
      },
      body,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    expect(processLineWebhook).toHaveBeenCalledOnce();
  });

  it("GET / serves the landing page with bot links", async () => {
    const response = await fetchWorker("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("Arnold");
    expect(html).toContain("https://t.me/tryarnold_bot");
    expect(html).toContain("https://line.me/R/ti/p/@386edctb");
  });
});
