export type UnitPreference = "metric" | "imperial";

const LBS_PER_KG = 2.20462;
const CM_PER_INCH = 2.54;

export function kgToLbs(kg: number): number {
  return kg * LBS_PER_KG;
}

export function lbsToKg(lbs: number): number {
  return lbs / LBS_PER_KG;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    return { feet: feet + 1, inches: 0 };
  }
  return { feet, inches };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function formatWeight(kg: number, pref: UnitPreference): string {
  if (pref === "imperial") {
    return `${Math.round(kgToLbs(kg))} lbs`;
  }
  return `${Math.round(kg * 10) / 10} kg`;
}

export function formatHeight(cm: number, pref: UnitPreference): string {
  if (pref === "imperial") {
    const { feet, inches } = cmToFeetInches(cm);
    return `${feet}'${inches}"`;
  }
  return `${Math.round(cm)} cm`;
}

/** Parse weight text to kg. Uses unit preference when units are omitted. */
export function parseWeight(text: string, pref: UnitPreference): number | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  const metricMatch = raw.match(/^([\d.]+)\s*(?:kg|kgs|kilos?)?$/);
  if (metricMatch && (raw.includes("kg") || raw.includes("kilo") || pref === "metric")) {
    const val = parseFloat(metricMatch[1]!);
    if (val > 0 && val < 500) return val;
  }

  const imperialMatch = raw.match(/^([\d.]+)\s*(?:lbs?|pounds?)?$/);
  if (imperialMatch && (raw.includes("lb") || raw.includes("pound") || pref === "imperial")) {
    const val = parseFloat(imperialMatch[1]!);
    if (val > 0 && val < 1100) return lbsToKg(val);
  }

  const bare = raw.match(/^([\d.]+)$/);
  if (bare) {
    const val = parseFloat(bare[1]!);
    if (pref === "imperial") {
      if (val > 0 && val < 1100) return lbsToKg(val);
    } else if (val > 0 && val < 500) {
      return val;
    }
  }

  return null;
}

/** Parse height text to cm. Supports metric cm/m and imperial ft/in. */
export function parseHeight(text: string, pref: UnitPreference): number | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  const feetInches =
    raw.match(/^(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*(?:["″]|in(?:ches?)?)?$/) ??
    raw.match(/^(\d+)\s*(?:ft|feet|foot)\s*(\d+(?:\.\d+)?)\s*(?:in(?:ches?)?)?$/);
  if (feetInches) {
    const feet = parseInt(feetInches[1]!, 10);
    const inches = parseFloat(feetInches[2]!);
    if (feet >= 3 && feet <= 8 && inches >= 0 && inches < 12) {
      return feetInchesToCm(feet, inches);
    }
    return null;
  }

  const inchesOnly = raw.match(/^([\d.]+)\s*(?:in(?:ches?)?)$/);
  if (inchesOnly) {
    const inches = parseFloat(inchesOnly[1]!);
    if (inches >= 48 && inches <= 96) return inches * CM_PER_INCH;
    return null;
  }

  const meters = raw.match(/^([\d.]+)\s*m(?:eters?)?$/);
  if (meters) {
    const m = parseFloat(meters[1]!);
    if (m > 0.9 && m < 2.5) return m * 100;
    return null;
  }

  const cmMatch = raw.match(/^([\d.]+)\s*(?:cm)?$/);
  if (cmMatch) {
    const val = parseFloat(cmMatch[1]!);
    if (raw.includes("cm") || (pref === "metric" && val > 50 && val < 260)) {
      if (val > 50 && val < 260) return val;
    }
    if (pref === "imperial" && val >= 48 && val <= 96) {
      return val * CM_PER_INCH;
    }
  }

  return null;
}
