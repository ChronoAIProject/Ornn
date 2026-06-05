import { describe, expect, it } from "vitest";
import { formatFileSize, formatNumber } from "./formatters";

describe("formatNumber", () => {
  it("renders millions with an M suffix", () => {
    expect(formatNumber(1_000_000)).toBe("1.0M");
    expect(formatNumber(2_500_000)).toBe("2.5M");
  });

  it("renders thousands with a K suffix", () => {
    expect(formatNumber(1_000)).toBe("1.0K");
    expect(formatNumber(12_300)).toBe("12.3K");
  });

  it("renders sub-thousand values with locale grouping", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });
});

describe("formatFileSize", () => {
  it("returns the zero-byte early return", () => {
    expect(formatFileSize(0)).toBe("0 B");
  });

  it("renders raw bytes without a fractional part", () => {
    // i === 0 branch → toFixed(0).
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1)).toBe("1 B");
  });

  it("stays in bytes at the B→KB rollover boundary", () => {
    // 1023 < 1024 → log/log floors to i === 0, so still raw bytes.
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("renders kilobytes with one decimal", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("renders megabytes with one decimal", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("renders gigabytes with one decimal", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB");
  });
});
