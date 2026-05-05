/**
 * Pure-function unit tests for the quota date helpers.
 *
 * @module domains/quota/types.test
 */

import { describe, expect, test } from "bun:test";
import {
  currentDailyMarker,
  currentMonthlyMarker,
  freshSurfaceCounter,
  nextDailyResetAt,
  nextMonthlyResetAt,
} from "./types";

describe("quota types: marker math", () => {
  test("monthly marker is YYYY-MM in UTC, not local", () => {
    const t = new Date(Date.UTC(2026, 3, 30, 23, 30, 0));
    expect(currentMonthlyMarker(t)).toBe("2026-04");
  });

  test("daily marker is YYYY-MM-DD in UTC", () => {
    const t = new Date(Date.UTC(2026, 4, 5, 12, 0, 0));
    expect(currentDailyMarker(t)).toBe("2026-05-05");
  });

  test("monthly marker zero-pads single-digit months", () => {
    const t = new Date(Date.UTC(2026, 0, 15, 0, 0, 0));
    expect(currentMonthlyMarker(t)).toBe("2026-01");
  });

  test("nextMonthlyResetAt rolls year on December", () => {
    const t = new Date(Date.UTC(2026, 11, 15, 12, 0, 0));
    const next = nextMonthlyResetAt(t);
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("nextDailyResetAt rolls month on month-end", () => {
    const t = new Date(Date.UTC(2026, 4, 31, 22, 0, 0));
    const next = nextDailyResetAt(t);
    expect(next.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  test("freshSurfaceCounter starts at zero with current markers", () => {
    const t = new Date(Date.UTC(2026, 4, 5, 0, 0, 0));
    const c = freshSurfaceCounter(t);
    expect(c.monthlyUsed).toBe(0);
    expect(c.dailyUsed).toBe(0);
    expect(c.creditsBalance).toBe(0);
    expect(c.monthlyResetMarker).toBe("2026-05");
    expect(c.dailyResetMarker).toBe("2026-05-05");
  });
});
