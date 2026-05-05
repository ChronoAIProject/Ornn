/**
 * Unit tests for the pure quota decision function. Exercises the spec
 * rules (#250):
 *   - Monthly base hits 0 → 429.
 *   - Credits cover post-base calls → still allowed.
 *   - Daily ceiling caps the combined pool.
 *
 * @module domains/quota/service.test
 */

import { describe, expect, test } from "bun:test";
import { decide } from "./service";
import type { SurfaceCounter, SurfaceLimits } from "./types";

const limits: SurfaceLimits = { monthlyBase: 200, dailyCeiling: 50 };

function counter(over: Partial<SurfaceCounter> = {}): SurfaceCounter {
  return {
    monthlyUsed: 0,
    dailyUsed: 0,
    creditsBalance: 0,
    monthlyResetMarker: "2026-05",
    dailyResetMarker: "2026-05-04",
    ...over,
  };
}

describe("quota decide()", () => {
  test("fresh user is allowed", () => {
    const d = decide(counter(), limits, "playground");
    expect(d.allowed).toBe(true);
  });

  test("monthly base exhausted with zero credits ⇒ 429 monthly", () => {
    const d = decide(counter({ monthlyUsed: 200 }), limits, "playground");
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.scope).toBe("monthly");
    expect(d.message).toContain("monthly");
    expect(d.message).toContain("playground");
  });

  test("monthly base exhausted but credits available ⇒ allowed", () => {
    const d = decide(counter({ monthlyUsed: 200, creditsBalance: 5 }), limits, "playground");
    expect(d.allowed).toBe(true);
  });

  test("daily ceiling hit ⇒ 429 daily even with credits", () => {
    const d = decide(
      counter({ monthlyUsed: 10, creditsBalance: 100, dailyUsed: 50 }),
      limits,
      "playground",
    );
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.scope).toBe("daily");
  });

  test("skillGen surface message says skill-generation", () => {
    const d = decide(
      counter({ monthlyUsed: 20 }),
      { monthlyBase: 20, dailyCeiling: 5 },
      "skillGen",
    );
    expect(d.allowed).toBe(false);
    if (d.allowed) return;
    expect(d.message).toContain("skill-generation");
  });
});
