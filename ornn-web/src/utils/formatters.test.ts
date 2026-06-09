import { describe, expect, it } from "vitest";
import { formatDateSGT, formatFileSize, formatNumber } from "./formatters";

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

describe("formatDateSGT", () => {
  // 03:43:42 UTC = 11:43:42 Asia/Singapore (+08:00) same day.
  const ISO = "2026-05-25T03:43:42Z";
  // 17:00 UTC = 01:00 next-day Asia/Singapore — locks the TZ offset.
  const ISO2 = "2026-05-24T17:00:00Z";
  const EN_MONTHS = /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/;

  it("renders Chinese-formatted output (no English months) in zh mode", () => {
    const out = formatDateSGT(ISO, "zh", { withSeconds: true });
    // The whole point of #752: zh must NOT silently fall back to English
    // months. Bun is full-ICU so zh-CN resolves; if this assertion ever
    // fails it means the locale fell back to en — a real regression.
    expect(out).not.toMatch(EN_MONTHS);
    expect(out).toMatch(/[年月日]/);
  });

  it("preserves the exact en-SG output (English parity, with seconds)", () => {
    // Snapshot of the en-SG output for this ISO — locks byte-identical
    // English-mode rendering for the SkillCard call site. The shared
    // formatter uses the same option set as the old local copies, so the
    // English path is unchanged. (The day/month-name/digit separator is
    // ICU-version-dependent; this literal matches the test runtime's ICU.)
    expect(formatDateSGT(ISO, "en", { withSeconds: true })).toBe("25 May 2026, 11:43:42");
  });

  it("omits seconds when withSeconds is unset (default = false)", () => {
    const out = formatDateSGT(ISO, "en");
    expect(out).toBe("25 May 2026, 11:43");
    // 43:42 seconds must not leak through the default no-seconds path.
    expect(out).not.toMatch(/:\d{2}:\d{2}/);
  });

  it("honours the Asia/Singapore offset across the day boundary", () => {
    // 17:00 UTC on the 24th is 01:00 on the 25th in SGT.
    expect(formatDateSGT(ISO2, "en")).toMatch(/25 May 2026/);
    expect(formatDateSGT(ISO2, "zh")).toMatch(/25日/);
  });
});
