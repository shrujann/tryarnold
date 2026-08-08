import type { Env } from "./env";
import { getSettings } from "./config";
import { TelegramChannel } from "./channels/telegram";
import { LineChannel, verifyLineSignature } from "./channels/line";
import {
  processLineWebhook,
  processTelegramUpdate,
} from "./handlers/dispatcher";
import { renderLandingPage } from "./landing/page";
import { verifyMediaToken } from "./services/media-token";
import { verifyReportToken } from "./services/report-token";
import { serveDailyReportPdf } from "./handlers/daily-report";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function checkAdminAuth(request: Request, env: Env): boolean {
  const settings = getSettings(env);
  if (!settings.adminSecret) return false;
  const header = request.headers.get("X-Admin-Secret") ?? "";
  return header === settings.adminSecret;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const settings = getSettings(env);

    try {
      if (path === "/favicon.ico") {
        return new Response("", { status: 204 });
      }

      if (method === "GET" && path === "/healthz") {
        return jsonResponse({
          status: "ok",
          app: settings.appName,
          ai_enabled: settings.aiEnabled,
          fatsecret_enabled: settings.fatsecretEnabled,
          memory_backend: "d1-context",
          telegram_enabled: Boolean(settings.telegramBotToken),
          line_enabled: Boolean(settings.lineChannelAccessToken),
          runtime: "worker",
        });
      }

      if (method === "POST" && path === "/telegram/webhook/ping") {
        return jsonResponse({ ok: true, ping: true });
      }

      if (method === "POST" && path === "/telegram/webhook") {
        const secret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
        if (secret !== settings.telegramWebhookSecret) {
          return jsonResponse({ detail: "invalid secret token" }, 403);
        }

        const update = await request.json();
        const channel = new TelegramChannel(settings);
        try {
          await processTelegramUpdate(env, env.DB, channel, update);
        } catch (err) {
          console.error("Telegram webhook failed", {
            errName: err instanceof Error ? err.name : "Error",
            errDetail: err instanceof Error ? err.message : String(err),
          });
          return jsonResponse(
            {
              ok: false,
              error: err instanceof Error ? err.name : "Error",
              detail: err instanceof Error ? err.message : String(err),
            },
            500,
          );
        }
        return jsonResponse({ ok: true });
      }

      if (method === "POST" && path === "/line/webhook") {
        if (!settings.lineChannelSecret) {
          return jsonResponse({ detail: "LINE not configured" }, 503);
        }

        const body = await request.text();
        const signature = request.headers.get("x-line-signature") ?? "";
        const valid = await verifyLineSignature(
          body,
          signature,
          settings.lineChannelSecret,
        );
        if (!valid) {
          return jsonResponse({ detail: "invalid signature" }, 403);
        }

        const payload = JSON.parse(body);
        const channel = new LineChannel(settings);
        ctx.waitUntil(
          processLineWebhook(env, env.DB, channel, payload).catch((err) => {
            console.error("LINE webhook processing failed", err);
          }),
        );
        return jsonResponse({ ok: true });
      }

      if (method === "POST" && path === "/admin/set-webhook") {
        if (!checkAdminAuth(request, env)) {
          return jsonResponse({ detail: "unauthorized" }, 401);
        }
        try {
          const channel = new TelegramChannel(settings);
          if (!channel.enabled) throw new Error("Telegram not configured");
          const ok = await channel.setWebhook();
          return jsonResponse({ ok, url: settings.webhookUrl });
        } catch (err) {
          return jsonResponse(
            {
              detail: err instanceof Error ? err.message : String(err),
              error: err instanceof Error ? err.name : "Error",
            },
            502,
          );
        }
      }

      if (method === "POST" && path === "/admin/delete-webhook") {
        if (!checkAdminAuth(request, env)) {
          return jsonResponse({ detail: "unauthorized" }, 401);
        }
        try {
          const channel = new TelegramChannel(settings);
          if (!channel.enabled) throw new Error("Telegram not configured");
          const ok = await channel.deleteWebhook();
          return jsonResponse({ ok });
        } catch (err) {
          return jsonResponse(
            {
              detail: err instanceof Error ? err.message : String(err),
              error: err instanceof Error ? err.name : "Error",
            },
            502,
          );
        }
      }

      if (method === "POST" && path === "/admin/set-line-webhook") {
        if (!checkAdminAuth(request, env)) {
          return jsonResponse({ detail: "unauthorized" }, 401);
        }
        try {
          const channel = new LineChannel(settings);
          if (!channel.enabled) throw new Error("LINE not configured");
          const ok = await channel.setWebhook();
          return jsonResponse({ ok, url: settings.lineWebhookUrl });
        } catch (err) {
          return jsonResponse(
            {
              detail: err instanceof Error ? err.message : String(err),
              error: err instanceof Error ? err.name : "Error",
            },
            502,
          );
        }
      }

      if (method === "POST" && path === "/admin/delete-line-webhook") {
        if (!checkAdminAuth(request, env)) {
          return jsonResponse({ detail: "unauthorized" }, 401);
        }
        try {
          const channel = new LineChannel(settings);
          if (!channel.enabled) throw new Error("LINE not configured");
          const ok = await channel.deleteWebhook();
          return jsonResponse({ ok });
        } catch (err) {
          return jsonResponse(
            {
              detail: err instanceof Error ? err.message : String(err),
              error: err instanceof Error ? err.name : "Error",
            },
            502,
          );
        }
      }

      if (method === "GET" && path.startsWith("/media/")) {
        const token = decodeURIComponent(path.slice("/media/".length));
        const payload = await verifyMediaToken(settings, token);
        if (!payload) {
          return new Response("not found", { status: 404 });
        }

        try {
          const channel =
            payload.channel === "line"
              ? new LineChannel(settings)
              : new TelegramChannel(settings);
          if (!channel.enabled) {
            return new Response("channel unavailable", { status: 503 });
          }
          const image = await channel.downloadPhoto(payload.mediaRef);
          return new Response(image.bytes, {
            status: 200,
            headers: {
              "content-type": image.mime || "image/jpeg",
              "cache-control": "private, max-age=300",
            },
          });
        } catch (err) {
          console.error("Media proxy failed", err);
          return new Response("media unavailable", { status: 502 });
        }
      }

      if (method === "GET" && path.startsWith("/reports/") && path.endsWith(".pdf")) {
        const raw = path.slice("/reports/".length, -".pdf".length);
        const token = decodeURIComponent(raw);
        const payload = await verifyReportToken(settings, token);
        if (!payload) {
          return new Response("not found", { status: 404 });
        }
        try {
          return await serveDailyReportPdf(env, payload);
        } catch (err) {
          console.error("Report PDF serve failed", err);
          return new Response("report unavailable", { status: 502 });
        }
      }

      if (method === "GET" && (path === "/" || path === "/index.html")) {
        return new Response(renderLandingPage(settings), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      return jsonResponse({ detail: "not found" }, 404);
    } catch (err) {
      return jsonResponse(
        {
          ok: false,
          stage: "fetch",
          error: err instanceof Error ? err.name : "Error",
          detail: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  },
};
