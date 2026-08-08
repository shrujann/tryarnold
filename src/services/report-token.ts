import type { Settings } from "../config";

const REPORT_TTL_SECONDS = 60 * 60;

function signingSecret(settings: Settings): string {
  return (
    settings.adminSecret ||
    settings.telegramWebhookSecret ||
    settings.lineChannelSecret ||
    "dev-report-secret"
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64Url(new Uint8Array(sig));
}

export type ReportTokenPayload = {
  userId: number;
  channel: string;
  dayStart: string;
  exp: number;
};

export async function signReportToken(
  settings: Settings,
  payload: Omit<ReportTokenPayload, "exp">,
  ttlSeconds = REPORT_TTL_SECONDS,
): Promise<string> {
  const full: ReportTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(full)),
  );
  const sig = await hmacSign(signingSecret(settings), body);
  return `${body}.${sig}`;
}

export async function verifyReportToken(
  settings: Settings,
  token: string,
): Promise<ReportTokenPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmacSign(signingSecret(settings), body);
  if (expected.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i)! ^ sig.charCodeAt(i)!;
  }
  if (ok !== 0) return null;

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    const payload = JSON.parse(json) as ReportTokenPayload;
    if (
      typeof payload.userId !== "number" ||
      !payload.channel ||
      !payload.dayStart ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function buildReportDownloadUrl(
  settings: Settings,
  payload: Omit<ReportTokenPayload, "exp">,
): Promise<string> {
  const token = await signReportToken(settings, payload);
  return `${settings.publicBaseUrl.replace(/\/$/, "")}/reports/${token}.pdf`;
}
