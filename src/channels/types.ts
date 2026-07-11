export interface InboundPhoto {
  fileId: string;
  fileUniqueId: string;
  width?: number;
  height?: number;
  messageId?: string;
}

export interface InboundMessage {
  channel: string;
  externalUserId: string;
  chatId: string | number;
  text?: string | null;
  photo?: InboundPhoto | null;
  caption?: string | null;
  username?: string | null;
  firstName?: string | null;
  callbackData?: string | null;
  callbackQueryId?: string | null;
  callbackMessageId?: number | null;
  replyToken?: string | null;
  isFollow?: boolean;
  timestamp?: Date;
  raw?: unknown;
}

export type ButtonRow = Array<{ label: string; data: string }>;

export interface DownloadedImage {
  bytes: Uint8Array;
  mime: string;
}

export interface MessagingChannel {
  readonly name: string;
  readonly enabled: boolean;
  sendText(
    chatId: string | number,
    text: string,
    replyToken?: string | null,
    parseMode?: "HTML",
  ): Promise<void>;
  sendTextWithKeyboard(
    chatId: string | number,
    text: string,
    buttons: ButtonRow[],
    replyToken?: string | null,
    parseMode?: "HTML",
  ): Promise<number | string | null>;
  sendTextWithQuickReply?(
    chatId: string | number,
    text: string,
    buttons: ButtonRow[],
    replyToken?: string | null,
  ): Promise<number | string | null>;
  editMessageReplyMarkup?(
    chatId: string | number,
    messageId: string | number,
    buttons: ButtonRow[],
  ): Promise<void>;
  editMessageText?(
    chatId: string | number,
    messageId: string | number,
    text: string,
    parseMode?: "HTML",
    buttons?: ButtonRow[],
  ): Promise<void>;
  clearMessageReplyMarkup?(
    chatId: string | number,
    messageId: string | number,
  ): Promise<void>;
  deleteMessage?(
    chatId: string | number,
    messageId: string | number,
  ): Promise<void>;
  /** Telegram-only: send plain text and return message_id for later deletion. */
  sendTextReturningId?(
    chatId: string | number,
    text: string,
  ): Promise<number | null>;
  answerCallback?(callbackQueryId: string, options?: { text?: string }): Promise<void>;
  downloadPhoto(fileId: string): Promise<DownloadedImage>;
  parseUpdate(update: unknown): InboundMessage | InboundMessage[] | null;
}

export function hasPhoto(msg: InboundMessage): boolean {
  return msg.photo != null;
}

export function isCallback(msg: InboundMessage): boolean {
  return msg.callbackData != null;
}

export function displayText(msg: InboundMessage): string {
  return msg.text || msg.caption || "";
}

export function detectMime(contentType: string | null, filePath?: string): string {
  if (contentType) {
    const base = contentType.split(";")[0]?.trim().toLowerCase();
    if (base?.startsWith("image/")) return base;
  }
  if (filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      heic: "image/heic",
    };
    if (map[ext]) return map[ext];
  }
  return "image/jpeg";
}
