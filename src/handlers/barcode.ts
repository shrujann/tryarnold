import type { Env } from "../env";
import { getSettings } from "../config";
import type { InboundMessage, MessagingChannel } from "../channels/types";
import type { UserRow } from "../db/users";
import { insertPendingMeal } from "../db/pending-meals";
import {
  estimateFromBarcodeFood,
  findFoodByBarcode,
} from "../services/fatsecret";
import { createLogger } from "../services/logger";
import { sendMealConfirmUi } from "./clarification";
import { sendOut } from "./commands";

export async function handleBarcodeLookup(
  env: Env,
  db: D1Database,
  channel: MessagingChannel,
  msg: InboundMessage,
  user: UserRow,
  barcode: string,
): Promise<void> {
  const settings = getSettings(env);
  const logger = createLogger(settings.logLevel);

  if (!settings.fatsecretEnabled) {
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "barcode lookup needs FatSecret credentials. set FATSECRET_CONSUMER_KEY/SECRET.",
      msg.replyToken,
    );
    return;
  }

  logger.info({
    stage: "barcode_lookup",
    userId: user.id,
    barcode,
    channel: channel.name,
  });

  try {
    const food = await findFoodByBarcode(barcode, settings);
    if (!food) {
      await sendOut(
        channel,
        db,
        msg.chatId,
        user.id,
        channel.name,
        `couldn't find barcode ${barcode} in FatSecret. try another code or send a food photo.`,
        msg.replyToken,
      );
      return;
    }

    const estimate = estimateFromBarcodeFood(food, barcode);
    if (!estimate.items.length || estimate.calories <= 0) {
      await sendOut(
        channel,
        db,
        msg.chatId,
        user.id,
        channel.name,
        `found ${estimate.description || "that product"} but it has no usable serving data. try a food photo instead.`,
        msg.replyToken,
      );
      return;
    }

    await insertPendingMeal(db, {
      userId: user.id,
      estimate,
      baseMultiplier: 1,
      mediaRef: msg.photo?.fileId,
      mediaUniqueRef: msg.photo?.fileUniqueId,
      photoCaption: msg.caption ?? `barcode ${barcode}`,
      phase: "confirm",
    });

    await sendMealConfirmUi(
      env,
      db,
      channel,
      msg.chatId,
      user,
      estimate,
      true,
      msg.replyToken,
    );
  } catch (err) {
    console.error("Barcode lookup failed", err);
    await sendOut(
      channel,
      db,
      msg.chatId,
      user.id,
      channel.name,
      "couldn't look up that barcode right now. try again in a moment.",
      msg.replyToken,
    );
  }
}
