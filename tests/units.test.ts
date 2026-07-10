import { describe, expect, it } from "vitest";
import {
  cmToFeetInches,
  feetInchesToCm,
  formatHeight,
  formatWeight,
  lbsToKg,
  parseHeight,
  parseWeight,
} from "../src/services/units";

describe("parseWeight", () => {
  it("parses metric weights", () => {
    expect(parseWeight("70", "metric")).toBe(70);
    expect(parseWeight("70 kg", "metric")).toBe(70);
    expect(parseWeight("70kg", "metric")).toBe(70);
  });

  it("parses imperial weights", () => {
    expect(parseWeight("165 lbs", "imperial")).toBeCloseTo(lbsToKg(165), 2);
    expect(parseWeight("165", "imperial")).toBeCloseTo(lbsToKg(165), 2);
  });

  it("rejects invalid weights", () => {
    expect(parseWeight("", "metric")).toBeNull();
    expect(parseWeight("abc", "metric")).toBeNull();
    expect(parseWeight("0", "metric")).toBeNull();
  });
});

describe("parseHeight", () => {
  it("parses cm", () => {
    expect(parseHeight("175 cm", "metric")).toBe(175);
    expect(parseHeight("175", "metric")).toBe(175);
  });

  it("parses meters", () => {
    expect(parseHeight("1.75 m", "metric")).toBeCloseTo(175, 0);
  });

  it("parses feet and inches", () => {
    expect(parseHeight("5'10", "imperial")).toBeCloseTo(feetInchesToCm(5, 10), 0);
    expect(parseHeight("5 ft 10 in", "imperial")).toBeCloseTo(feetInchesToCm(5, 10), 0);
    expect(parseHeight("70 in", "imperial")).toBeCloseTo(70 * 2.54, 0);
  });

  it("rejects invalid heights", () => {
    expect(parseHeight("2'", "imperial")).toBeNull();
    expect(parseHeight("hello", "metric")).toBeNull();
  });
});

describe("formatters", () => {
  it("formats weight by preference", () => {
    expect(formatWeight(70, "metric")).toBe("70 kg");
    expect(formatWeight(70, "imperial")).toMatch(/lbs$/);
  });

  it("formats height by preference", () => {
    expect(formatHeight(178, "metric")).toBe("178 cm");
    const imperial = formatHeight(178, "imperial");
    expect(imperial).toMatch(/'\d+"/);
    const { feet, inches } = cmToFeetInches(178);
    expect(imperial).toBe(`${feet}'${inches}"`);
  });
});
