import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { extractBarcodeFromImage } from "../agents/barcode-vision";
import { estimateFromImage } from "../agents/vision";
import { extractBarcodeCandidate } from "../services/barcode";
import { createLogger } from "../services/logger";
import { handleBarcodeLookup } from "./barcode";
import { sendOut } from "./commands";
import { startClarifyFlowFromVision } from "./clarification";

export async function handlePhoto(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
): Promise<void> {
  const settings = getSettings(env);
  const userId = user.id;
  const chatId = msg.chatId;

  if (!settings.aiEnabled) {
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "can't read photos right now. set OPENROUTER_API_KEY and try again.",
      msg.replyToken,
    );
    return;
  }

  if (!msg.photo) return;

  const logger = createLogger(settings.logLevel);
  logger.info({
    stage: "photo_received",
    userId,
    channel: channel.name,
    hasCaption: Boolean(msg.caption),
  });

  try {
    const image = await channel.downloadPhoto(msg.photo.fileId);

    // Fast path: caption already contains barcode digits.
    const captionBarcode = msg.caption
      ? extractBarcodeCandidate(msg.caption)
      : null;
    if (captionBarcode) {
      logger.info({
        stage: "photo_barcode",
        userId,
        barcode: captionBarcode,
        source: "caption",
      });
      if (settings.fatsecretEnabled) {
        await handleBarcodeLookup(env, db, channel, msg, user, captionBarcode);
        return;
      }
      await sendOut(
        channel,
        db,
        chatId,
        userId,
        channel.name,
        `saw barcode ${captionBarcode}, but FatSecret isn't configured.`,
        msg.replyToken,
      );
      return;
    }

    // Vision path: detect barcode in the image before food estimation.
    logger.info({ stage: "barcode_check", userId, source: "vision" });
    const visionBarcode = await extractBarcodeFromImage(
      env,
      image.bytes,
      image.mime,
    );
    if (visionBarcode) {
      logger.info({
        stage: "photo_barcode",
        userId,
        barcode: visionBarcode,
        source: "vision",
      });
      if (settings.fatsecretEnabled) {
        await handleBarcodeLookup(env, db, channel, msg, user, visionBarcode);
        return;
      }
      await sendOut(
        channel,
        db,
        chatId,
        userId,
        channel.name,
        `saw barcode ${visionBarcode}, but FatSecret isn't configured.`,
        msg.replyToken,
      );
      return;
    }

    const { estimate: draft, clarification } = await estimateFromImage(
      env,
      image.bytes,
      image.mime,
      msg.caption,
    );

    logger.info({
      stage: "photo_vision",
      userId,
      calories: draft.calories,
      toggles: clarification.toggles.length,
      exclusive: clarification.exclusive?.id ?? null,
      items: (draft.items ?? []).map((i) => i.name),
    });

    let estimate = draft;
    const multiplier = Number(user.portion_multiplier ?? 1);

    if (estimate.calories > settings.mealConfirmMaxCalories) {
      estimate = {
        ...estimate,
        portion_confidence: Math.min(estimate.portion_confidence || 0.5, 0.3),
      };
    }

    await startClarifyFlowFromVision(
      env,
      db,
      channel,
      msg,
      user,
      estimate,
      clarification,
      multiplier,
      { bytes: image.bytes, mime: image.mime },
    );
  } catch (err) {
    console.error("Photo processing failed", err);
    await sendOut(
      channel,
      db,
      chatId,
      userId,
      channel.name,
      "couldn't read that photo. tell me roughly what it was.",
      msg.replyToken,
    );
  }
}
