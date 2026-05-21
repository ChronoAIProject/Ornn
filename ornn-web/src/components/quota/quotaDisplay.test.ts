/**
 * displayUsagePercent tests — pins the #629 "never round up to 100%"
 * contract.
 *
 * @module components/quota/quotaDisplay.test
 */
import { describe, it, expect } from "vitest";
import { displayUsagePercent } from "./quotaDisplay";

describe("displayUsagePercent", () => {
  it("returns 0 when ceiling is 0", () => {
    expect(displayUsagePercent(0, 0, 0)).toBe(0);
  });

  it("returns 100 when remaining is 0", () => {
    expect(displayUsagePercent(100, 100, 0)).toBe(100);
    expect(displayUsagePercent(50, 100, 0)).toBe(100);
  });

  it("clamps to 99 when 1 call remains and naive rounding would say 100", () => {
    // #629 reproducer — used=199 ceiling=200 → 99.5% → naive round → 100.
    // With remaining=1, must display 99%.
    expect(displayUsagePercent(199, 200, 1)).toBe(99);
  });

  it("uses floor (not round) so 99.9% reads as 99%", () => {
    expect(displayUsagePercent(999, 1000, 1)).toBe(99);
  });

  it("normal mid-range usage rounds down", () => {
    expect(displayUsagePercent(50, 100, 50)).toBe(50);
    expect(displayUsagePercent(49, 100, 51)).toBe(49);
    expect(displayUsagePercent(1, 100, 99)).toBe(1);
  });

  it("clamps 0 from below (defensive against negative used)", () => {
    expect(displayUsagePercent(-5, 100, 105)).toBe(0);
  });
});
