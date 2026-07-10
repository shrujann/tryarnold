import type { Env } from "./env";

export interface Settings {
  appName: string;
  logLevel: string;
  publicBaseUrl: string;
  appRuntime: string;
  telegramBotToken: string | undefined;
  telegramWebhookSecret: string;
  openrouterApiKey: string | undefined;
  openrouterModel: string;
  openrouterVisionModel: string;
  openrouterProviderOrder: string | undefined;
  lineChannelSecret: string | undefined;
  lineChannelAccessToken: string | undefined;
  adminSecret: string | undefined;
  portionConfidenceThreshold: number;
  mealConfirmMaxCalories: number;
  pendingMealTtlMinutes: number;
  portionSizeSmall: number;
  portionSizeLarge: number;
  webhookPath: string;
  lineWebhookPath: string;
  webhookUrl: string;
  lineWebhookUrl: string;
  aiEnabled: boolean;
  telegramBotUrl: string;
  lineAddUrl: string;
}

function envStr(env: Env, key: keyof Env, fallback?: string): string | undefined {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  return String(value);
}

export function getSettings(env: Env): Settings {
  const publicBaseUrl =
    envStr(env, "PUBLIC_BASE_URL", "http://localhost:8787") ??
    "http://localhost:8787";
  const webhookPath = "/telegram/webhook";
  const lineWebhookPath = "/line/webhook";

  return {
    appName: envStr(env, "APP_NAME", "telegram-fitness-coach") ?? "telegram-fitness-coach",
    logLevel: envStr(env, "LOG_LEVEL", "INFO") ?? "INFO",
    publicBaseUrl,
    appRuntime: envStr(env, "APP_RUNTIME", "worker") ?? "worker",
    telegramBotToken: envStr(env, "TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret:
      envStr(env, "TELEGRAM_WEBHOOK_SECRET", "change-me") ?? "change-me",
    openrouterApiKey: envStr(env, "OPENROUTER_API_KEY"),
    openrouterModel: envStr(env, "OPENROUTER_MODEL", "openai/gpt-4o") ?? "openai/gpt-4o",
    openrouterVisionModel:
      envStr(env, "OPENROUTER_VISION_MODEL", "openai/gpt-4o") ?? "openai/gpt-4o",
    openrouterProviderOrder: envStr(env, "OPENROUTER_PROVIDER_ORDER"),
    lineChannelSecret: envStr(env, "LINE_CHANNEL_SECRET"),
    lineChannelAccessToken: envStr(env, "LINE_CHANNEL_ACCESS_TOKEN"),
    adminSecret: envStr(env, "ADMIN_SECRET"),
    portionConfidenceThreshold: parseFloat(
      envStr(env, "PORTION_CONFIDENCE_THRESHOLD", "0.6") ?? "0.6",
    ),
    mealConfirmMaxCalories: parseInt(
      envStr(env, "MEAL_CONFIRM_MAX_CALORIES", "1200") ?? "1200",
      10,
    ),
    pendingMealTtlMinutes: parseInt(
      envStr(env, "PENDING_MEAL_TTL_MINUTES", "30") ?? "30",
      10,
    ),
    portionSizeSmall: parseFloat(envStr(env, "PORTION_SIZE_SMALL", "0.7") ?? "0.7"),
    portionSizeLarge: parseFloat(envStr(env, "PORTION_SIZE_LARGE", "1.3") ?? "1.3"),
    webhookPath,
    lineWebhookPath,
    webhookUrl: `${publicBaseUrl.replace(/\/$/, "")}${webhookPath}`,
    lineWebhookUrl: `${publicBaseUrl.replace(/\/$/, "")}${lineWebhookPath}`,
    aiEnabled: Boolean(envStr(env, "OPENROUTER_API_KEY")),
    telegramBotUrl: envStr(env, "TELEGRAM_BOT_URL", "#") ?? "#",
    lineAddUrl: envStr(env, "LINE_ADD_URL", "#") ?? "#",
  };
}
