import { describe, expect, it } from "vitest";
import {
  scoreToBand,
  bandStyle,
  styleForScore,
  formatAgentSealVersion,
} from "./agentsealBand";

describe("scoreToBand", () => {
  it("buckets scores into the AgentSeal-spec bands", () => {
    expect(scoreToBand(100)).toBe("excellent");
    expect(scoreToBand(85)).toBe("excellent");
    expect(scoreToBand(84)).toBe("high");
    expect(scoreToBand(70)).toBe("high");
    expect(scoreToBand(69)).toBe("medium");
    expect(scoreToBand(50)).toBe("medium");
    expect(scoreToBand(49)).toBe("low");
    expect(scoreToBand(30)).toBe("low");
    expect(scoreToBand(29)).toBe("critical");
    expect(scoreToBand(0)).toBe("critical");
  });

  it("treats out-of-range or NaN scores conservatively (critical)", () => {
    expect(scoreToBand(Number.NaN)).toBe("critical");
    expect(scoreToBand(-10)).toBe("critical");
    // High overflow still lands in 'excellent' since we only clamp
    // downside; an upstream score >100 is still 'safe-shaped'.
    expect(scoreToBand(150)).toBe("excellent");
  });
});

describe("bandStyle", () => {
  it("maps every band to a forge-palette token bundle", () => {
    for (const band of ["excellent", "high", "medium", "low", "critical"] as const) {
      const style = bandStyle(band);
      expect(style.band).toBe(band);
      expect(style.label).toBeTruthy();
      expect(style.surface).toContain("border");
      expect(style.swatch).toBeTruthy();
      expect(style.ink).toBeTruthy();
    }
  });

  it("never uses raw consumer green/red color values", () => {
    // Every band's tokens reference the semantic state palette
    // (success / warning / danger). No raw Tailwind green-/red-.
    for (const band of ["excellent", "high", "medium", "low", "critical"] as const) {
      const style = bandStyle(band);
      const blob = `${style.surface} ${style.swatch} ${style.ink}`;
      expect(blob).not.toMatch(/(green|red|yellow|amber|emerald|orange)-/);
    }
  });
});

describe("styleForScore", () => {
  it("composes scoreToBand + bandStyle", () => {
    expect(styleForScore(95).band).toBe("excellent");
    expect(styleForScore(60).band).toBe("medium");
    expect(styleForScore(20).band).toBe("critical");
  });
});

describe("formatAgentSealVersion", () => {
  it("strips the agentseal- prefix and prepends a friendly label", () => {
    expect(formatAgentSealVersion("agentseal-0.4.1")).toBe("AgentSeal 0.4.1");
    expect(formatAgentSealVersion("agentseal/0.4.1")).toBe("AgentSeal 0.4.1");
  });

  it("returns the raw string when there's no recognizable prefix", () => {
    expect(formatAgentSealVersion("0.4.1")).toBe("0.4.1");
    expect(formatAgentSealVersion(undefined)).toBe("AgentSeal");
  });
});
