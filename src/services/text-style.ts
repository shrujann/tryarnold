const EMOJI_PATTERN =
  /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{2190}-\u{21ff}\u{2b00}-\u{2bff}\u{fe00}-\u{fe0f}\u{200d}\u{20e3}]+/gu;

const DEFAULT_MAX_CHARS = 280;
const HARD_GUARD_CHARS = 600;
const SENTENCE_END = /(?<=[.!?])\s+/;

export function stripEmoji(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let cleaned = text.replace(EMOJI_PATTERN, "");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");
  cleaned = cleaned.replace(/ *\n */g, "\n");
  const lines = cleaned.split("\n").map((line) => line.trimEnd());
  return lines.join("\n").trim();
}

function safeLengthGuard(text: string, maxChars: number): string {
  if (text.length <= HARD_GUARD_CHARS) return text;

  const sentences = text.split(SENTENCE_END);
  const kept: string[] = [];
  let total = 0;
  for (const sentence of sentences) {
    if (kept.length > 0 && total + sentence.length > maxChars) break;
    kept.push(sentence);
    total += sentence.length + 1;
  }

  const candidate = kept.map((s) => s.trim()).join(" ").trim();
  if (candidate && candidate.length >= 40) return candidate;
  return text;
}

export function styleChatReply(
  text: string | null | undefined,
  maxChars = DEFAULT_MAX_CHARS,
): string {
  const cleaned = stripEmoji(text);
  if (!cleaned) return cleaned;
  return safeLengthGuard(cleaned, maxChars);
}
