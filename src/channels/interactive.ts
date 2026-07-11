import type { ButtonRow, MessagingChannel } from "./types";

export type InteractiveMessageOpts = {
  parseMode?: "HTML";
  editMessageId?: string | number | null;
  editMarkupOnly?: boolean;
};

export async function clearCallbackKeyboard(
  channel: MessagingChannel,
  chatId: string | number,
  messageId: string | number | null | undefined,
): Promise<void> {
  if (
    channel.name === "telegram" &&
    messageId != null &&
    channel.clearMessageReplyMarkup
  ) {
    await channel.clearMessageReplyMarkup(chatId, messageId);
  }
}

/** @alias clearCallbackKeyboard */
export const clearInteractiveKeyboard = clearCallbackKeyboard;

/** Send or update a text message with optional inline/quick-reply buttons. */
export async function sendInteractiveMessage(
  channel: MessagingChannel,
  chatId: string | number,
  text: string,
  buttons: ButtonRow[],
  replyToken?: string | null,
  opts?: InteractiveMessageOpts,
): Promise<string | number | null> {
  const isTelegram = channel.name === "telegram";
  const editId = opts?.editMessageId;

  if (isTelegram && editId != null) {
    if (opts?.editMarkupOnly && channel.editMessageReplyMarkup) {
      await channel.editMessageReplyMarkup(chatId, editId, buttons);
      return editId;
    }
    if (channel.editMessageText && !opts?.editMarkupOnly) {
      try {
        await channel.editMessageText(
          chatId,
          editId,
          text,
          opts?.parseMode,
          buttons.length > 0 ? buttons : undefined,
        );
        return editId;
      } catch {
        // Fall through to send a new message.
      }
    }
  }

  if (buttons.length === 0) {
    await channel.sendText(chatId, text, replyToken, opts?.parseMode);
    return null;
  }

  const messageId = await channel.sendTextWithKeyboard(
    chatId,
    text,
    buttons,
    replyToken,
    isTelegram ? opts?.parseMode : undefined,
  );
  return messageId;
}
