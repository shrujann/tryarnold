import { HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { Env } from "../env";
import { getSettings } from "../config";
import { createVisionModel } from "./llm";
import { normalizeGtin13 } from "../services/barcode";
import { createLogger } from "../services/logger";

const barcodeVisionSchema = z.object({
  has_barcode: z.boolean(),
  barcode_digits: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

const MIN_BARCODE_CONFIDENCE = 0.7;

/**
 * Detect a retail barcode in a photo and return normalized GTIN-13 digits.
 * Returns null when the image is not a barcode (e.g. a food photo).
 */
export async function extractBarcodeFromImage(
  env: Env,
  imageBytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  const settings = getSettings(env);
  if (!settings.aiEnabled) return null;

  const logger = createLogger(settings.logLevel);
  const model = createVisionModel(env).withStructuredOutput(barcodeVisionSchema, {
    name: "barcode_extract",
    method: "functionCalling",
    strict: true,
  });

  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  try {
    const result = barcodeVisionSchema.parse(
      await model.invoke([
        new HumanMessage({
          content: [
            {
              type: "text",
              text:
                "Does this image primarily show a product barcode (UPC/EAN/JAN lines or digits under a barcode)? " +
                "If yes, read the barcode digits only (no spaces). If this is a food/meal photo without a clear barcode, " +
                "set has_barcode=false and barcode_digits=null. confidence is 0–1.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }),
      ]),
    );

    logger.debug({
      stage: "barcode_vision",
      has_barcode: result.has_barcode,
      barcode_digits: result.barcode_digits,
      confidence: result.confidence,
    });

    if (!result.has_barcode || result.confidence < MIN_BARCODE_CONFIDENCE) {
      return null;
    }
    if (!result.barcode_digits) return null;
    return normalizeGtin13(result.barcode_digits);
  } catch (err) {
    logger.warn({
      stage: "barcode_vision",
      message: "barcode extraction failed; treating as food photo",
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
