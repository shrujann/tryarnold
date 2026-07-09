import type { Settings } from "../config";
import { stripEmoji } from "../services/text-style";
import type {
  ButtonRow,
  DownloadedImage,
  InboundMessage,
  InboundPhoto,
  MessagingChannel,
} from "./types";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
};

function detectMimeFromPath(path: string, contentType: string | null): string {
  if (contentType && contentType.startsWith("image/")) {
    return contentType.split(";")[0]!.trim();
  }
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "image/jpeg";
}

function chunkText(text: string, size: number): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export class TelegramChannel implements MessagingChannel {
  readonly name = "telegram";

  constructor(
    private readonly settings: Settings,
    private readonly token?: string,
  ) {}

  get enabled(): boolean {
    return Boolean(this.token ?? this.settings.telegramBotToken);
  }

  private get botToken(): string {
    const token = this.token ?? this.settings.telegramBotToken;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    return token;
  }

  private get baseUrl(): string {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  private get fileUrl(): string {
    return `https://api.telegram.org/file/bot${this.botToken}`;
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) {
      throw new Error(data.description ?? `Telegram ${method} failed`);
    }
    return data.result;
  }

  async sendText(chatId: string | number, text: string): Promise<void> {
    const cleaned = stripEmoji(text);
    for (const chunk of chunkText(cleaned, 4096)) {
      await this.call("sendMessage", { chat_id: chatId, text: chunk });
    }
  }

  async sendTextWithKeyboard(
    chatId: string | number,
    text: string,
    buttons: ButtonRow[],
  ): Promise<void> {
    const replyMarkup = {
      inline_keyboard: buttons.map((row) =>
        row.map((btn) => ({ text: btn.label, callback_data: btn.data })),
      ),
    };
    await this.call("sendMessage", {
      chat_id: chatId,
      text: stripEmoji(text),
      reply_markup: replyMarkup,
    });
  }

  async answerCallback(callbackQueryId: string): Promise<void> {
    try {
      await this.call("answerCallbackQuery", { callback_query_id: callbackQueryId });
    } catch {
      // Non-fatal: spinner may already be cleared
    }
  }

  async downloadPhoto(fileId: string): Promise<DownloadedImage> {
    const result = (await this.call("getFile", { file_id: fileId })) as {
      file_path?: string;
    };
    const path = result.file_path;
    if (!path) {
      throw new Error("Telegram file_path missing");
    }

    const resp = await fetch(`${this.fileUrl}/${path}`);
    if (!resp.ok) {
      throw new Error(`Telegram file download failed: ${resp.status} path=${path}`);
    }

    const mime = detectMimeFromPath(path, resp.headers.get("content-type"));
    const bytes = new Uint8Array(await resp.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error(`Telegram file download empty: path=${path}`);
    }

    return { bytes, mime };
  }

  async setWebhook(): Promise<boolean> {
    await this.call("setWebhook", {
      url: this.settings.webhookUrl,
      secret_token: this.settings.telegramWebhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
    return true;
  }

  async deleteWebhook(): Promise<boolean> {
    await this.call("deleteWebhook", { drop_pending_updates: false });
    return true;
  }

  parseUpdate(update: unknown): InboundMessage | null {
    if (!update || typeof update !== "object") return null;
    const u = update as Record<string, unknown>;

    const callback = u.callback_query;
    if (callback && typeof callback === "object") {
      const cb = callback as Record<string, unknown>;
      const fromUser = (cb.from ?? {}) as Record<string, unknown>;
      const message = (cb.message ?? {}) as Record<string, unknown>;
      const chat = (message.chat ?? {}) as Record<string, unknown>;
      return {
        channel: this.name,
        externalUserId: String(fromUser.id),
        chatId: Number(chat.id ?? fromUser.id),
        text: String(cb.data ?? ""),
        callbackData: String(cb.data ?? ""),
        callbackQueryId: String(cb.id ?? ""),
        username: fromUser.username ? String(fromUser.username) : null,
        firstName: fromUser.first_name ? String(fromUser.first_name) : null,
        raw: update,
      };
    }

    const message = (u.message ?? u.edited_message) as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") return null;

    const fromUser = message.from as Record<string, unknown> | undefined;
    if (!fromUser?.id) return null;

    let photo: InboundPhoto | null = null;
    const photos = message.photo as Array<Record<string, unknown>> | undefined;
    if (photos?.length) {
      const largest = photos[photos.length - 1]!;
      photo = {
        fileId: String(largest.file_id),
        fileUniqueId: String(largest.file_unique_id),
        width: largest.width ? Number(largest.width) : undefined,
        height: largest.height ? Number(largest.height) : undefined,
      };
    }

    const document = message.document as Record<string, unknown> | undefined;
    if (!photo && document) {
      const mimeType = String(document.mime_type ?? "");
      if (mimeType.startsWith("image/")) {
        photo = {
          fileId: String(document.file_id),
          fileUniqueId: String(document.file_unique_id ?? document.file_id),
        };
      }
    }

    const chat = (message.chat ?? {}) as Record<string, unknown>;
    return {
      channel: this.name,
      externalUserId: String(fromUser.id),
      chatId: Number(chat.id ?? fromUser.id),
      text: message.text ? String(message.text) : null,
      photo,
      caption: message.caption ? String(message.caption) : null,
      username: fromUser.username ? String(fromUser.username) : null,
      firstName: fromUser.first_name ? String(fromUser.first_name) : null,
      raw: update,
    };
  }
}

export function createTelegramChannel(settings: Settings): TelegramChannel {
  return new TelegramChannel(settings);
}
