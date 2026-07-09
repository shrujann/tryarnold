import { ChatOpenRouter } from "@langchain/openrouter";
import type { Env } from "../env";
import { getSettings } from "../config";

export function createChatModel(env: Env) {
  const settings = getSettings(env);
  return new ChatOpenRouter({
    model: settings.openrouterModel,
    apiKey: settings.openrouterApiKey,
    temperature: 0.4,
    siteUrl: settings.publicBaseUrl,
    siteName: settings.appName,
    ...(settings.openrouterProviderOrder
      ? { provider: { order: settings.openrouterProviderOrder.split(",") } }
      : {}),
  });
}

export function createVisionModel(env: Env) {
  const settings = getSettings(env);
  return new ChatOpenRouter({
    model: settings.openrouterVisionModel,
    apiKey: settings.openrouterApiKey,
    temperature: 0.2,
    siteUrl: settings.publicBaseUrl,
    siteName: settings.appName,
  });
}
