import type { Settings } from "../config";
import { buildMediaProxyUrl } from "./media-token";

export type OutboundPhoto = {
  /** Telegram file_id — preferred when available. */
  fileId?: string;
  /** Public HTTPS URL (LINE image messages require this). */
  imageUrl?: string;
};

/**
 * Resolve how to re-send a stored meal photo for a channel.
 * Telegram reuses file_id; LINE uses a short-lived worker media proxy URL.
 */
export async function resolveOutboundPhoto(
  channelName: string,
  mediaRef: string | null | undefined,
  settings: Settings,
): Promise<OutboundPhoto | null> {
  if (!mediaRef) return null;

  if (channelName === "telegram") {
    return { fileId: mediaRef };
  }

  if (channelName === "line") {
    return { imageUrl: await buildMediaProxyUrl(settings, "line", mediaRef) };
  }

  return { imageUrl: await buildMediaProxyUrl(settings, channelName, mediaRef) };
}
