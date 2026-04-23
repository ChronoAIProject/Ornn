import { describe, expect, test } from "bun:test";
import { computeOverallScore, computeVerdict, type AuditScore } from "./types";

function mkScores(values: [string, number][]): AuditScore[] {
  return values.map(([dimension, score]) => ({
    dimension: dimension as AuditScore["dimension"],
    score,
    rationale: "",
  }));
}

describe("computeOverallScore", () => {
  test("equal weights average, rounded to 1 dp", () => {
    const scores = mkScores([
      ["security", 8],
      ["code_quality", 7],
      ["documentation", 9],
      ["reliability", 8],
      ["permission_scope", 10],
    ]);
    expect(computeOverallScore(scores)).toBe(8.4);
  });

  test("empty -> 0", () => {
    expect(computeOverallScore([])).toBe(0);
  });
});

describe("computeVerdict", () => {
  test("green when all dims >= 5 and overall >= 7.5 and no criticals", () => {
    const scores = mkScores([
      ["security", 9],
      ["code_quality", 8],
      ["documentation", 7],
      ["reliability", 8],
      ["permission_scope", 9],
    ]);
    expect(computeVerdict(scores, [])).toBe("green");
  });

  test("yellow when overall < 7.5", () => {
    const scores = mkScores([
      ["security", 7],
      ["code_quality", 7],
      ["documentation", 6],
      ["reliability", 7],
      ["permission_scope", 7],
    ]);
    expect(computeVerdict(scores, [])).toBe("yellow");
  });

  test("yellow when any dim below minPerDimension", () => {
    const scores = mkScores([
      ["security", 10],
      ["code_quality", 10],
      ["documentation", 4], // below 5
      ["reliability", 10],
      ["permission_scope", 10],
    ]);
    expect(computeVerdict(scores, [])).toBe("yellow");
  });

  test("red when any dim drops 2 below threshold", () => {
    const scores = mkScores([
      ["security", 10],
      ["code_quality", 10],
      ["documentation", 2], // <= 3 = red
      ["reliability", 10],
      ["permission_scope", 10],
    ]);
    expect(computeVerdict(scores, [])).toBe("red");
  });

  test("red when any finding is critical, even if scores are all 10", () => {
    const scores = mkScores([
      ["security", 10],
      ["code_quality", 10],
      ["documentation", 10],
      ["reliability", 10],
      ["permission_scope", 10],
    ]);
    expect(
      computeVerdict(scores, [
        { dimension: "security", severity: "critical", message: "arbitrary code execution" },
      ]),
    ).toBe("red");
  });
});
