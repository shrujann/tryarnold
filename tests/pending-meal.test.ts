import { describe, expect, it } from "vitest";
import { normalizeAction, normalizeActionWithSettings } from "../src/services/pending-meal";
import { getSettings } from "../src/config";
import type { Env } from "../src/env";

const mockEnv = {
  PORTION_SIZE_SMALL: "0.7",
  PORTION_SIZE_LARGE: "1.3",
} as Env;

const settings = getSettings(mockEnv);

describe("normalizeAction", () => {
  it("parses meal: prefixed callbacks", () => {
    expect(normalizeAction("meal:log")).toBe("log");
    expect(normalizeAction("meal:size_s")).toBe("s");
    expect(normalizeAction("meal:skip")).toBe("skip");
  });

  it("returns null for unknown actions", () => {
    expect(normalizeAction("meal:unknown")).toBeNull();
    expect(normalizeAction("hello")).toBeNull();
  });

  it("works with settings-aware variant", () => {
    expect(normalizeActionWithSettings("meal:bigger", settings)).toBe("bigger");
    expect(normalizeActionWithSettings("BIGGER", settings)).toBe("bigger");
  });
});
