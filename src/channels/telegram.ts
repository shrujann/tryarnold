import type { Settings } from "../config";
import { stripEmoji } from "../services/text-style";
import type {
  ButtonRow,
  DownloadedImage,
  InboundMessage,
  InboundPhoto,
  MessagingChannel,
  SendDocumentOptions,
  SendPhotoOptions,
} from "./types";

const TELEGRAM_CAPTION_MAX = 1024;

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

  private isBenignTelegramError(description: string): boolean {
    return (
      description.includes("message is not modified") ||
      description.includes("query is too old") ||
      description.includes("query ID is invalid")
    );
  }

  private async call(method: string, payload: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json()) as { ok?: boolean; result?: unknown; description?: string };
    if (!data.ok) {
      const detail = data.description ?? `Telegram ${method} failed`;
      if (this.isBenignTelegramError(detail)) {
        return data.result ?? null;
      }
      throw new Error(detail);
    }
    return data.result;
  }

  async sendText(
    chatId: string | number,
    text: string,
    _replyToken?: string | null,
    parseMode?: "HTML",
  ): Promise<void> {
    await this.sendTextReturningId(chatId, text, parseMode);
  }

  async sendTextReturningId(
    chatId: string | number,
    text: string,
    parseMode?: "HTML",
  ): Promise<number | null> {
    const cleaned = stripEmoji(text);
    const chunks = chunkText(cleaned, 4096);
    let lastMessageId: number | null = null;
    for (const chunk of chunks) {
      const payload: Record<string, unknown> = { chat_id: chatId, text: chunk };
      if (parseMode) {
        payload.parse_mode = parseMode;
      }
      const result = (await this.call("sendMessage", payload)) as {
        message_id?: number;
      };
      lastMessageId = result.message_id ?? lastMessageId;
    }
    return lastMessageId;
  }

  async deleteMessage(
    chatId: string | number,
    messageId: string | number,
  ): Promise<void> {
    try {
      await this.call("deleteMessage", {
        chat_id: chatId,
        message_id: Number(messageId),
      });
    } catch {
      // Non-fatal if already deleted or too old.
    }
  }

  async sendTextWithKeyboard(
    chatId: string | number,
    text: string,
    buttons: ButtonRow[],
    _replyToken?: string | null,
    parseMode?: "HTML",
  ): Promise<number | null> {
    const replyMarkup = {
      inline_keyboard: buttons.map((row) =>
        row.map((btn) => ({ text: btn.label, callback_data: btn.data })),
      ),
    };
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: stripEmoji(text),
      reply_markup: replyMarkup,
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }
    const result = (await this.call("sendMessage", payload)) as {
      message_id?: number;
    };
    return result.message_id ?? null;
  }

  async editMessageReplyMarkup(
    chatId: string | number,
    messageId: string | number,
    buttons: ButtonRow[],
  ): Promise<void> {
    const replyMarkup = {
      inline_keyboard: buttons.map((row) =>
        row.map((btn) => ({ text: btn.label, callback_data: btn.data })),
      ),
    };
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: Number(messageId),
      reply_markup: replyMarkup,
    });
  }

  async editMessageText(
    chatId: string | number,
    messageId: string | number,
    text: string,
    parseMode?: "HTML",
    buttons?: ButtonRow[],
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: Number(messageId),
      text: stripEmoji(text),
    };
    if (parseMode) {
      payload.parse_mode = parseMode;
    }
    if (buttons) {
      payload.reply_markup = {
        inline_keyboard: buttons.map((row) =>
          row.map((btn) => ({ text: btn.label, callback_data: btn.data })),
        ),
      };
    }
    await this.call("editMessageText", payload);
  }

  async clearMessageReplyMarkup(
    chatId: string | number,
    messageId: string | number,
  ): Promise<void> {
    await this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: Number(messageId),
      reply_markup: { inline_keyboard: [] },
    });
  }

  async answerCallback(
    callbackQueryId: string,
    options?: { text?: string },
  ): Promise<void> {
    try {
      const payload: Record<string, unknown> = {
        callback_query_id: callbackQueryId,
      };
      if (options?.text) {
        payload.text = options.text;
        payload.show_alert = false;
      }
      await this.call("answerCallbackQuery", payload);
    } catch {
      // Non-fatal: spinner may already be cleared
    }
  }

  async sendPhoto(
    chatId: string | number,
    options: SendPhotoOptions,
  ): Promise<void> {
    const photo = options.fileId || options.imageUrl;
    if (!photo) {
      throw new Error("Telegram sendPhoto requires fileId or imageUrl");
    }

    const payload: Record<string, unknown> = {
      chat_id: chatId,
      photo,
    };
    if (options.caption) {
      const caption = stripEmoji(options.caption).slice(0, TELEGRAM_CAPTION_MAX);
      payload.caption = caption;
      if (options.parseMode) {
        payload.parse_mode = options.parseMode;
      }
    }
    await this.call("sendPhoto", payload);
  }

  async sendDocument(
    chatId: string | number,
    options: SendDocumentOptions,
  ): Promise<void> {
    if (options.bytes && options.bytes.byteLength > 0) {
      const form = new FormData();
      form.append("chat_id", String(chatId));
      form.append(
        "document",
        new Blob([options.bytes], {
          type: options.mimeType || "application/pdf",
        }),
        options.filename,
      );
      if (options.caption) {
        form.append("caption", stripEmoji(options.caption));
      }
      const resp = await fetch(`${this.baseUrl}/sendDocument`, {
        method: "POST",
        body: form,
      });
      const data = (await resp.json()) as {
        ok?: boolean;
        description?: string;
      };
      if (!data.ok) {
        throw new Error(data.description ?? "Telegram sendDocument failed");
      }
      return;
    }

    if (!options.fileUrl) {
      throw new Error("Telegram sendDocument requires bytes or fileUrl");
    }
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      document: options.fileUrl,
    };
    if (options.caption) {
      payload.caption = stripEmoji(options.caption);
    }
    await this.call("sendDocument", payload);
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
        callbackMessageId: message.message_id ? Number(message.message_id) : null,
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
