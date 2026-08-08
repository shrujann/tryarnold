/** Strip to digits and normalize to GTIN-13 for FatSecret barcode lookup. */
export function normalizeGtin13(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.length === 13) return digits;
  if (digits.length === 12) return digits.padStart(13, "0"); // UPC-A
  if (digits.length === 8) return digits.padStart(13, "0"); // EAN-8
  if (digits.length === 14 && digits.startsWith("0")) return digits.slice(1);

  return null;
}

/**
 * Parse a typed barcode message.
 * Accepts `/barcode 0123…` or a message that is only barcode digits (8–14).
 */
export function extractBarcodeFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const cmd = trimmed.match(/^\/barcode(?:@\w+)?(?:\s+(.+))?$/i);
  if (cmd) {
    const rest = (cmd[1] ?? "").trim();
    if (!rest) return null;
    return normalizeGtin13(rest);
  }

  // Plain text: only digits / spaces / dashes, barcode length.
  if (!/^[\d\s\-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return normalizeGtin13(digits);
}

/**
 * Find a barcode-like digit run inside mixed text (e.g. photo captions).
 * Prefers longer original digit runs (13 > 12 > 14 > 8).
 */
export function extractBarcodeCandidate(text: string): string | null {
  const direct = extractBarcodeFromText(text);
  if (direct) return direct;

  const digitRuns = text.match(/\d(?:[\d\s\-]{6,20})\d/g) ?? [];
  const candidates = digitRuns
    .map((run) => {
      const digits = run.replace(/\D/g, "");
      const normalized = normalizeGtin13(run);
      return normalized ? { digits, normalized } : null;
    })
    .filter((value): value is { digits: string; normalized: string } =>
      Boolean(value),
    );

  if (!candidates.length) return null;

  const prefer = (len: number) =>
    candidates.find((c) => c.digits.length === len)?.normalized;
  return prefer(13) ?? prefer(12) ?? prefer(14) ?? prefer(8) ?? candidates[0]!.normalized;
}

export function isBarcodeCommand(text: string): boolean {
  return /^\/barcode(?:@\w+)?(?:\s|$)/i.test(text.trim());
}
