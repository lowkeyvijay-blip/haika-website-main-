import { describe, expect, it } from "vitest";

import {
  createFixedClock,
  createManualClock,
  createSystemClock,
} from "./clock";

describe("clocks", () => {
  it("returns defensive copies from a fixed clock", () => {
    const clock = createFixedClock("2026-11-02T09:00:00.000Z");
    const first = clock.now();
    first.setUTCFullYear(2000);

    expect(clock.now().toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("rejects invalid fixed dates", () => {
    expect(() => createFixedClock("not-a-date")).toThrow(RangeError);
  });

  it("sets and advances a manual clock", () => {
    const clock = createManualClock("2026-11-02T09:00:00.000Z");

    clock.advanceBy(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe("2026-11-02T10:30:00.000Z");

    clock.set("2026-11-04T12:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-11-04T12:00:00.000Z");
  });

  it("reads the current system time", () => {
    const before = Date.now();
    const value = createSystemClock().now().getTime();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });
});
