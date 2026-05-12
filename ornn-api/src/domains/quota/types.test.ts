/**
 * Pure-function tests for the quota date helpers + key derivation.
 *
 * @module domains/quota/types.test
 */

import { describe, expect, test } from "bun:test";
import {
  bucketId,
  currentMonthMarker,
  escapeModelKey,
  monthBounds,
  nextMonthlyResetAt,
} from "./types";

describe("currentMonthMarker", () => {
  test("YYYY-MM in UTC, not local", () => {
    expect(currentMonthMarker(new Date(Date.UTC(2026, 3, 30, 23, 30)))).toBe("2026-04");
  });
  test("zero-pads single-digit months", () => {
    expect(currentMonthMarker(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-01");
  });
});

describe("nextMonthlyResetAt", () => {
  test("first instant of next UTC month", () => {
    const next = nextMonthlyResetAt(new Date(Date.UTC(2026, 4, 15)));
    expect(next.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
  test("year rollover", () => {
    const next = nextMonthlyResetAt(new Date(Date.UTC(2026, 11, 31, 23, 59, 59, 999)));
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("monthBounds", () => {
  test("monthStart is 1st 00:00:00.000Z; monthEnd is exclusive next month", () => {
    const b = monthBounds(new Date(Date.UTC(2026, 4, 15, 12)));
    expect(b.monthMarker).toBe("2026-05");
    expect(b.monthStart.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(b.monthEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  test("first millisecond of month belongs to that month", () => {
    const b = monthBounds(new Date(Date.UTC(2026, 5, 1, 0, 0, 0, 0)));
    expect(b.monthMarker).toBe("2026-06");
  });

  test("last millisecond of May belongs to May", () => {
    const b = monthBounds(new Date(Date.UTC(2026, 4, 31, 23, 59, 59, 999)));
    expect(b.monthMarker).toBe("2026-05");
  });
});

describe("bucketId", () => {
  test("composes id from triple", () => {
    expect(bucketId("u1", "playground", "2026-05")).toBe("u1:playground:2026-05");
  });
});

describe("escapeModelKey", () => {
  test("returns __unknown__ for empty / null / undefined", () => {
    expect(escapeModelKey("")).toBe("__unknown__");
    expect(escapeModelKey(null)).toBe("__unknown__");
    expect(escapeModelKey(undefined)).toBe("__unknown__");
  });
  test("substitutes Mongo-illegal characters", () => {
    expect(escapeModelKey("gpt-4o.0")).toBe("gpt-4o_0");
    expect(escapeModelKey("$model")).toBe("_model");
  });
  test("passes plain ids through", () => {
    expect(escapeModelKey("gpt-4o")).toBe("gpt-4o");
  });
});
