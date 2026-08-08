import {
  PDFDocument,
  PDFString,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  FATSECRET_PLATFORM_URL,
  fatsecretPoweredByPngBytes,
} from "../assets/fatsecret-attribution";
import type { DailyProgress } from "../db/users";
import type { MealRow } from "../db/meals";
import type { MacroEstimate } from "../schemas/nutrition";
import { macroEstimateFromDict } from "../schemas/nutrition";
import { getDisplayableItems } from "./meal-format";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 48;
const MARGIN_TOP = 48;
const MARGIN_BOTTOM = 64;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

const COLOR = {
  ink: rgb(0.12, 0.12, 0.12),
  muted: rgb(0.42, 0.42, 0.42),
  line: rgb(0.88, 0.88, 0.88),
  soft: rgb(0.96, 0.96, 0.96),
  white: rgb(1, 1, 1),
};

const IMAGE_SIZE = 120;
const CARD_PAD = 14;
const MEAL_GAP = 20;
const FOOTER_LOGO_HEIGHT = 18;
const TEXT_GAP = 16;

export type ReportMealImage = {
  bytes: Uint8Array;
  mime: string;
} | null;

export type DailyReportPdfInput = {
  dateLabel: string;
  timezone: string;
  progress: DailyProgress;
  meals: Array<{
    meal: MealRow;
    estimate: MacroEstimate;
    timeLabel: string;
    image: ReportMealImage;
  }>;
};

function estimateFromMealRow(meal: MealRow): MacroEstimate {
  let items: unknown[] = [];
  if (meal.items_json) {
    try {
      const parsed = JSON.parse(meal.items_json);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  return macroEstimateFromDict({
    description: meal.description || "meal",
    calories: Number(meal.calories) || 0,
    protein_g: Number(meal.protein_g) || 0,
    carbs_g: Number(meal.carbs_g) || 0,
    fat_g: Number(meal.fat_g) || 0,
    confidence: Number(meal.confidence) || 0.5,
    food_confidence: Number(meal.confidence) || 0.5,
    portion_confidence: 0.5,
    assumptions: [],
    items,
  });
}

export function mealEstimateFromRow(meal: MealRow): MacroEstimate {
  return estimateFromMealRow(meal);
}

function formatDayLabel(timezone: string, reference = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone || "UTC",
    }).format(reference);
  } catch {
    return reference.toISOString().slice(0, 10);
  }
}

export function formatReportDateLabel(timezone: string, reference = new Date()): string {
  return formatDayLabel(timezone, reference);
}

export function formatMealTimeLabel(ts: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone || "UTC",
    }).format(new Date(ts.includes("T") ? ts : `${ts}Z`));
  } catch {
    return "";
  }
}

function drawFooter(page: PDFPage, pdf: PDFDocument, logo: PDFImage): void {
  page.drawLine({
    start: { x: MARGIN_X, y: MARGIN_BOTTOM - 8 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: MARGIN_BOTTOM - 8 },
    thickness: 0.6,
    color: COLOR.line,
  });

  const logoH = FOOTER_LOGO_HEIGHT;
  const logoW = (logo.width / logo.height) * logoH;
  const x = MARGIN_X;
  const y = 22;
  page.drawImage(logo, { x, y, width: logoW, height: logoH });

  // Clickable attribution equivalent to the FatSecret HTML badge link.
  const linkRef = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + logoW, y + logoH],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(FATSECRET_PLATFORM_URL),
      },
    }),
  );
  page.node.addAnnot(linkRef);
}

async function embedMealImage(
  pdf: PDFDocument,
  image: ReportMealImage,
): Promise<PDFImage | null> {
  if (!image?.bytes?.byteLength) return null;
  const mime = (image.mime || "").toLowerCase();
  try {
    if (mime.includes("png")) {
      return await pdf.embedPng(image.bytes);
    }
    // Default to JPEG (covers image/jpeg and most camera uploads).
    return await pdf.embedJpg(image.bytes);
  } catch {
    try {
      return mime.includes("png")
        ? await pdf.embedJpg(image.bytes)
        : await pdf.embedPng(image.bytes);
    } catch {
      return null;
    }
  }
}

function drawHeader(page: PDFPage, brandFont: PDFFont, font: PDFFont, dateLabel: string): number {
  const top = PAGE_HEIGHT - MARGIN_TOP;
  page.drawText("Arnold", {
    x: MARGIN_X,
    y: top - 18,
    size: 22,
    font: brandFont,
    color: COLOR.ink,
  });

  const dateSize = 11;
  const dateWidth = font.widthOfTextAtSize(dateLabel, dateSize);
  page.drawText(dateLabel, {
    x: PAGE_WIDTH - MARGIN_X - dateWidth,
    y: top - 14,
    size: dateSize,
    font,
    color: COLOR.muted,
  });

  const ruleY = top - 36;
  page.drawLine({
    start: { x: MARGIN_X, y: ruleY },
    end: { x: PAGE_WIDTH - MARGIN_X, y: ruleY },
    thickness: 1,
    color: COLOR.ink,
  });
  return ruleY - 28;
}

function drawSummary(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  y: number,
  progress: DailyProgress,
): number {
  page.drawText("Summary", {
    x: MARGIN_X,
    y,
    size: 13,
    font: bold,
    color: COLOR.ink,
  });
  y -= 18;

  const boxTop = y + 8;
  const rows: Array<[string, string]> = [
    [
      "Calories",
      progress.target_calories != null
        ? `${Math.round(progress.calories)} / ${Math.round(progress.target_calories)} kcal`
        : `${Math.round(progress.calories)} kcal`,
    ],
    [
      "Protein",
      progress.target_protein_g != null
        ? `${Math.round(progress.protein_g)} / ${Math.round(progress.target_protein_g)} g`
        : `${Math.round(progress.protein_g)} g`,
    ],
    [
      "Carbs",
      progress.target_carbs_g != null
        ? `${Math.round(progress.carbs_g)} / ${Math.round(progress.target_carbs_g)} g`
        : `${Math.round(progress.carbs_g)} g`,
    ],
    [
      "Fat",
      progress.target_fat_g != null
        ? `${Math.round(progress.fat_g)} / ${Math.round(progress.target_fat_g)} g`
        : `${Math.round(progress.fat_g)} g`,
    ],
  ];

  const rowH = 22;
  const boxH = 16 + rows.length * rowH;
  page.drawRectangle({
    x: MARGIN_X,
    y: boxTop - boxH,
    width: CONTENT_WIDTH,
    height: boxH,
    color: COLOR.soft,
    borderColor: COLOR.line,
    borderWidth: 0.8,
  });

  let rowY = boxTop - 20;
  for (const [label, value] of rows) {
    page.drawText(label, {
      x: MARGIN_X + 14,
      y: rowY,
      size: 10,
      font,
      color: COLOR.muted,
    });
    const valueWidth = bold.widthOfTextAtSize(value, 11);
    page.drawText(value, {
      x: PAGE_WIDTH - MARGIN_X - 14 - valueWidth,
      y: rowY,
      size: 11,
      font: bold,
      color: COLOR.ink,
    });
    rowY -= rowH;
  }

  y = boxTop - boxH - 10;
  const mealLine = `${progress.meals} meal${progress.meals === 1 ? "" : "s"} logged`;
  page.drawText(mealLine, {
    x: MARGIN_X,
    y,
    size: 9,
    font,
    color: COLOR.muted,
  });

  if (progress.target_calories != null && progress.remaining_calories != null) {
    const remaining = progress.remaining_calories;
    const remainingText =
      remaining >= 0
        ? `${Math.round(remaining)} kcal remaining`
        : `${Math.abs(Math.round(remaining))} kcal over target`;
    const w = font.widthOfTextAtSize(remainingText, 9);
    page.drawText(remainingText, {
      x: PAGE_WIDTH - MARGIN_X - w,
      y,
      size: 9,
      font,
      color: COLOR.muted,
    });
  }

  return y - 28;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = words[i]!;
    }
  }
  lines.push(current);
  return lines;
}

function mealTextLines(
  estimate: MacroEstimate,
  font: PDFFont,
  bold: PDFFont,
  textWidth: number,
  timeLabel: string,
): Array<{ text: string; size: number; font: PDFFont; color: typeof COLOR.ink }> {
  const lines: Array<{
    text: string;
    size: number;
    font: PDFFont;
    color: typeof COLOR.ink;
  }> = [];

  if (timeLabel) {
    lines.push({ text: timeLabel, size: 9, font, color: COLOR.muted });
  }

  const title = estimate.description?.trim() || "meal";
  for (const line of wrapText(title, bold, 12, textWidth)) {
    lines.push({ text: line, size: 12, font: bold, color: COLOR.ink });
  }

  lines.push({
    text: `${Math.round(estimate.calories)} kcal    P ${Math.round(estimate.protein_g)} g    C ${Math.round(estimate.carbs_g)} g    F ${Math.round(estimate.fat_g)} g`,
    size: 10,
    font,
    color: COLOR.ink,
  });

  const items = getDisplayableItems(estimate.items ?? []).slice(0, 6);
  for (const item of items) {
    const amount =
      item.volume_ml != null && item.volume_ml > 0
        ? `${Math.round(item.volume_ml)} ml`
        : item.weight_g > 0
          ? `${Math.round(item.weight_g)} g`
          : null;
    const label = amount
      ? `• ${item.name} — ${amount} (~${Math.round(item.calories)} kcal)`
      : `• ${item.name} — ${Math.round(item.calories)} kcal`;
    for (const line of wrapText(label, font, 9, textWidth)) {
      lines.push({ text: line, size: 9, font, color: COLOR.muted });
    }
  }

  return lines;
}

function mealTextHeight(lines: Array<{ size: number }>): number {
  if (!lines.length) return 0;
  let h = lines[0]!.size;
  for (let i = 1; i < lines.length; i++) {
    h += 4 + lines[i]!.size;
  }
  return h;
}

function mealBlockHeight(
  estimate: MacroEstimate,
  font: PDFFont,
  bold: PDFFont,
  textWidth: number,
  timeLabel: string,
): number {
  const lines = mealTextLines(estimate, font, bold, textWidth, timeLabel);
  const textH = mealTextHeight(lines);
  return CARD_PAD * 2 + Math.max(IMAGE_SIZE, textH);
}

function drawCoverImage(
  page: PDFPage,
  image: PDFImage,
  imgX: number,
  imgY: number,
): void {
  const scale = Math.max(IMAGE_SIZE / image.width, IMAGE_SIZE / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  const drawX = imgX + (IMAGE_SIZE - drawW) / 2;
  const drawY = imgY + (IMAGE_SIZE - drawH) / 2;

  page.pushOperators(pushGraphicsState());
  page.pushOperators(rectangle(imgX, imgY, IMAGE_SIZE, IMAGE_SIZE), clip(), endPath());
  page.drawImage(image, {
    x: drawX,
    y: drawY,
    width: drawW,
    height: drawH,
  });
  page.pushOperators(popGraphicsState());
}

function drawMealBlock(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  yTop: number,
  timeLabel: string,
  estimate: MacroEstimate,
  image: PDFImage | null,
): number {
  const textWidth = CONTENT_WIDTH - IMAGE_SIZE - CARD_PAD * 2 - TEXT_GAP;
  const blockH = mealBlockHeight(estimate, font, bold, textWidth, timeLabel);
  const yBottom = yTop - blockH;

  page.drawRectangle({
    x: MARGIN_X,
    y: yBottom,
    width: CONTENT_WIDTH,
    height: blockH,
    borderColor: COLOR.line,
    borderWidth: 0.7,
    color: COLOR.white,
  });

  // Image sits in a fixed left slot, vertically centered in the card.
  const imgX = MARGIN_X + CARD_PAD;
  const imgY = yBottom + (blockH - IMAGE_SIZE) / 2;

  page.drawRectangle({
    x: imgX,
    y: imgY,
    width: IMAGE_SIZE,
    height: IMAGE_SIZE,
    color: COLOR.soft,
  });

  if (image) {
    drawCoverImage(page, image, imgX, imgY);
  } else {
    const placeholder = "No photo";
    const pw = font.widthOfTextAtSize(placeholder, 9);
    page.drawText(placeholder, {
      x: imgX + (IMAGE_SIZE - pw) / 2,
      y: imgY + IMAGE_SIZE / 2 - 3,
      size: 9,
      font,
      color: COLOR.muted,
    });
  }

  const lines = mealTextLines(estimate, font, bold, textWidth, timeLabel);
  const textH = mealTextHeight(lines);
  const textX = imgX + IMAGE_SIZE + TEXT_GAP;
  if (lines.length) {
    // Vertically center text against the image when shorter; otherwise top-align to image.
    let textY =
      textH <= IMAGE_SIZE
        ? imgY + (IMAGE_SIZE + textH) / 2 - lines[0]!.size
        : imgY + IMAGE_SIZE - lines[0]!.size;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (i > 0) textY -= lines[i - 1]!.size + 4;
      page.drawText(line.text, {
        x: textX,
        y: textY,
        size: line.size,
        font: line.font,
        color: line.color,
      });
    }
  }

  return yBottom - MEAL_GAP;
}

/**
 * Build a clean A4 daily nutrition PDF.
 * Layout: brand+date header, summary vs goals, Full Breakdown meal cards, FatSecret footer.
 */
export async function buildDailyReportPdf(
  input: DailyReportPdfInput,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const fatsecretLogo = await pdf.embedPng(fatsecretPoweredByPngBytes());

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawFooter(page, pdf, fatsecretLogo);
  let y = drawHeader(page, bold, font, input.dateLabel);
  y = drawSummary(page, font, bold, y, input.progress);

  page.drawText("Full Breakdown", {
    x: MARGIN_X,
    y,
    size: 13,
    font: bold,
    color: COLOR.ink,
  });
  y -= 22;

  for (const entry of input.meals) {
    const embedded = await embedMealImage(pdf, entry.image);
    const textWidth = CONTENT_WIDTH - IMAGE_SIZE - CARD_PAD * 2 - TEXT_GAP;
    const need = mealBlockHeight(
      entry.estimate,
      font,
      bold,
      textWidth,
      entry.timeLabel,
    );
    if (y - need < MARGIN_BOTTOM + 12) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawFooter(page, pdf, fatsecretLogo);
      y = drawHeader(page, bold, font, input.dateLabel);
      page.drawText("Full Breakdown (continued)", {
        x: MARGIN_X,
        y,
        size: 12,
        font: bold,
        color: COLOR.ink,
      });
      y -= 20;
    }

    y = drawMealBlock(
      page,
      font,
      bold,
      y,
      entry.timeLabel,
      entry.estimate,
      embedded,
    );
  }

  if (!input.meals.length) {
    page.drawText("No meals logged for this day.", {
      x: MARGIN_X,
      y,
      size: 10,
      font,
      color: COLOR.muted,
    });
  }

  return pdf.save();
}
