import type { Settings } from "../config";

const MEDIA_TTL_SECONDS = 60 * 60; // 1 hour — enough for LINE to fetch on send

function mediaSigningSecret(settings: Settings): string {
  return (
    settings.adminSecret ||
    settings.telegramWebhookSecret ||
    settings.lineChannelSecret ||
    "dev-media-secret"
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

export type MediaTokenPayload = {
  channel: string;
  mediaRef: string;
  exp: number;
};

/** Create a short-lived URL path token for proxying a stored channel media ref. */
export async function signMediaToken(
  settings: Settings,
  channel: string,
  mediaRef: string,
  ttlSeconds = MEDIA_TTL_SECONDS,
): Promise<string> {
  const payload: MediaTokenPayload = {
    channel,
    mediaRef,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const sig = await hmacSign(mediaSigningSecret(settings), body);
  return `${body}.${sig}`;
}

export async function verifyMediaToken(
  settings: Settings,
  token: string,
): Promise<MediaTokenPayload | null> {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = await hmacSign(mediaSigningSecret(settings), body);
  if (expected.length !== sig.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) {
    ok |= expected.charCodeAt(i)! ^ sig.charCodeAt(i)!;
  }
  if (ok !== 0) return null;

  try {
    const json = new TextDecoder().decode(base64UrlToBytes(body));
    const payload = JSON.parse(json) as MediaTokenPayload;
    if (
      !payload?.channel ||
      !payload?.mediaRef ||
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

export async function buildMediaProxyUrl(
  settings: Settings,
  channel: string,
  mediaRef: string,
): Promise<string> {
  const token = await signMediaToken(settings, channel, mediaRef);
  const base = settings.publicBaseUrl.replace(/\/$/, "");
  return `${base}/media/${token}`;
}
