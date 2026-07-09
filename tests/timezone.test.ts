import { describe, expect, it } from "vitest";
import { startOfDayInTimezone } from "../src/db/client";

describe("startOfDayInTimezone", () => {
  it("returns ISO string for start of day in UTC", () => {
    const ref = new Date("2025-07-09T15:30:00.000Z");
    const start = startOfDayInTimezone("UTC", ref);
    expect(start).toBe("2025-07-09T00:00:00.000Z");
  });

  it("handles non-UTC timezone", () => {
    const ref = new Date("2025-07-09T15:30:00.000Z");
    const start = startOfDayInTimezone("America/New_York", ref);
    expect(new Date(start).getTime()).toBeLessThanOrEqual(ref.getTime());
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
    }).format(new Date(start));
    expect(localDate).toBe("2025-07-09");
  });
});
