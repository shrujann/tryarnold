import type { Settings } from "../config";
import { stripEmoji } from "../services/text-style";
import type {
  ButtonRow,
  DownloadedImage,
  InboundMessage,
  InboundPhoto,
  MessagingChannel,
} from "./types";

export async function verifyLineSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return signature === expected;
}

export class LineChannel implements MessagingChannel {
  readonly name = "line";

  constructor(
    private readonly settings: Settings,
    private readonly accessToken?: string,
  ) {}

  get enabled(): boolean {
    return Boolean(
      this.accessToken ??
        (this.settings.lineChannelAccessToken && this.settings.lineChannelSecret),
    );
  }

  private get token(): string {
    const token = this.accessToken ?? this.settings.lineChannelAccessToken;
    if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not configured");
    return token;
  }

  private async replyOrPush(
    chatId: string | number,
    messages: unknown[],
    replyToken?: string | null,
  ): Promise<void> {
    if (replyToken) {
      const resp = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ replyToken, messages }),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        throw new Error(`LINE reply failed: ${resp.status} ${detail}`);
      }
      return;
    }

    const resp = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: String(chatId), messages }),
    });
    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`LINE push failed: ${resp.status} ${detail}`);
    }
  }

  async sendText(
    chatId: string | number,
    text: string,
    replyToken?: string | null,
  ): Promise<void> {
    await this.replyOrPush(
      chatId,
      [{ type: "text", text: stripEmoji(text) }],
      replyToken,
    );
  }

  async sendTextWithKeyboard(
    chatId: string | number,
    text: string,
    buttons: ButtonRow[],
    replyToken?: string | null,
  ): Promise<void> {
    const footerButtons = buttons.flat().map((btn) => ({
      type: "button",
      style: "primary",
      height: "sm",
      action: {
        type: "postback",
        label: btn.label,
        data: btn.data,
      },
    }));

    const flexMessage = {
      type: "flex",
      altText: stripEmoji(text).slice(0, 400),
      contents: {
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "text",
              text: stripEmoji(text),
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "horizontal",
          contents: footerButtons,
          flex: 0,
        },
      },
    };

    await this.replyOrPush(chatId, [flexMessage], replyToken);
  }

  async downloadPhoto(messageId: string): Promise<DownloadedImage> {
    const resp = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!resp.ok) {
      throw new Error(`LINE content fetch failed: ${resp.status}`);
    }
    const mime = resp.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/jpeg";
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("LINE content fetch empty");
    }
    return { bytes, mime };
  }

  parseUpdate(update: unknown): InboundMessage[] | null {
    if (!update || typeof update !== "object") return null;
    const payload = update as { events?: unknown[] };
    if (!Array.isArray(payload.events)) return null;

    const messages: InboundMessage[] = [];
    for (const event of payload.events) {
      const parsed = this.parseEvent(event);
      if (parsed) messages.push(parsed);
    }
    return messages.length ? messages : null;
  }

  private parseEvent(event: unknown): InboundMessage | null {
    if (!event || typeof event !== "object") return null;
    const e = event as Record<string, unknown>;
    const source = (e.source ?? {}) as Record<string, unknown>;
    const userId = source.userId ? String(source.userId) : null;
    if (!userId) return null;

    const replyToken = e.replyToken ? String(e.replyToken) : null;

    if (e.type === "postback") {
      const postback = (e.postback ?? {}) as Record<string, unknown>;
      return {
        channel: this.name,
        externalUserId: userId,
        chatId: userId,
        text: String(postback.data ?? ""),
        callbackData: String(postback.data ?? ""),
        replyToken,
        raw: event,
      };
    }

    if (e.type !== "message") return null;
    const message = (e.message ?? {}) as Record<string, unknown>;
    const msgType = String(message.type ?? "");

    let photo: InboundPhoto | null = null;
    let text: string | null = null;

    if (msgType === "image") {
      photo = {
        fileId: String(message.id),
        fileUniqueId: String(message.id),
        messageId: String(message.id),
      };
    } else if (msgType === "text") {
      text = message.text ? String(message.text) : null;
    } else {
      return null;
    }

    return {
      channel: this.name,
      externalUserId: userId,
      chatId: userId,
      text,
      photo,
      replyToken,
      raw: event,
    };
  }
}
