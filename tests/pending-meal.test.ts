import { describe, expect, it } from "vitest";
import { normalizeActionWithSettings } from "../src/services/pending-meal";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";

const mockEnv = {
  PORTION_SIZE_SMALL: "0.7",
  PORTION_SIZE_LARGE: "1.3",
} as Env;

const settings = getSettings(mockEnv);

describe("normalizeActionWithSettings", () => {
  it("parses meal: prefixed callbacks", () => {
    expect(normalizeActionWithSettings("meal:log", settings)).toBe("log");
    expect(normalizeActionWithSettings("meal:size_s", settings)).toBe("s");
    expect(normalizeActionWithSettings("meal:skip", settings)).toBe("skip");
  });

  it("returns null for unknown actions", () => {
    expect(normalizeActionWithSettings("meal:unknown", settings)).toBeNull();
    expect(normalizeActionWithSettings("hello", settings)).toBeNull();
  });

  it("normalizes case and plain tokens", () => {
    expect(normalizeActionWithSettings("meal:bigger", settings)).toBe("bigger");
    expect(normalizeActionWithSettings("BIGGER", settings)).toBe("bigger");
  });
});
