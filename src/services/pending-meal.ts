import type { Settings } from "../config";

export function actionFactors(settings: Settings): Record<string, number | null> {
  const small = settings.portionSizeSmall;
  const large = settings.portionSizeLarge;
  return {
    log: 1.0,
    yes: 1.0,
    ok: 1.0,
    medium: 1.0,
    m: 1.0,
    smaller: small,
    small: small,
    s: small,
    bigger: large,
    large: large,
    l: large,
    skip: null,
  };
}

export function normalizeAction(text: string): string | null {
  let token = text.trim().toLowerCase();
  if (token.startsWith("meal:")) {
    token = token.split(":", 2)[1] ?? token;
    if (token.startsWith("size_")) {
      token = token.slice(5);
    }
  }
  const factors = actionFactors({
    portionSizeSmall: 0.7,
    portionSizeLarge: 1.3,
  } as Settings);
  return token in factors ? token : null;
}

export function normalizeActionWithSettings(
  text: string,
  settings: Settings,
): string | null {
  let token = text.trim().toLowerCase();
  if (token.startsWith("meal:")) {
    token = token.split(":", 2)[1] ?? token;
    if (token.startsWith("size_")) {
      token = token.slice(5);
    }
  }
  const factors = actionFactors(settings);
  return token in factors ? token : null;
}
