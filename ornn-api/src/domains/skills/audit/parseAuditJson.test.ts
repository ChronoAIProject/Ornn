import { describe, expect, test } from "bun:test";
import { parseAuditJson } from "./service";

describe("parseAuditJson", () => {
  test("parses a well-formed response", () => {
    const raw = `{
      "scores": [
        { "dimension": "security",         "score": 9, "rationale": "no dangerous patterns" },
        { "dimension": "code_quality",     "score": 8, "rationale": "good" },
        { "dimension": "documentation",    "score": 7, "rationale": "ok" },
        { "dimension": "reliability",      "score": 8, "rationale": "solid" },
        { "dimension": "permission_scope", "score": 9, "rationale": "least priv" }
      ],
      "findings": [
        { "dimension": "code_quality", "severity": "warning", "file": "scripts/main.js", "line": 10, "message": "unused var" }
      ]
    }`;
    const parsed = parseAuditJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.scores).toHaveLength(5);
    expect(parsed!.findings).toHaveLength(1);
    expect(parsed!.findings[0]!.severity).toBe("warning");
  });

  test("strips markdown fences", () => {
    const raw = [
      "```json",
      `{"scores":[`,
      `{"dimension":"security","score":5,"rationale":"ok"},`,
      `{"dimension":"code_quality","score":5,"rationale":"ok"},`,
      `{"dimension":"documentation","score":5,"rationale":"ok"},`,
      `{"dimension":"reliability","score":5,"rationale":"ok"},`,
      `{"dimension":"permission_scope","score":5,"rationale":"ok"}`,
      `],"findings":[]}`,
      "```",
    ].join("\n");
    const parsed = parseAuditJson(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.scores).toHaveLength(5);
    expect(parsed!.findings).toEqual([]);
  });

  test("returns null when a dimension is missing", () => {
    const raw = JSON.stringify({
      scores: [
        { dimension: "security", score: 9, rationale: "" },
        { dimension: "code_quality", score: 8, rationale: "" },
        // documentation missing
        { dimension: "reliability", score: 8, rationale: "" },
        { dimension: "permission_scope", score: 9, rationale: "" },
      ],
      findings: [],
    });
    expect(parseAuditJson(raw)).toBeNull();
  });

  test("clamps scores to 0–10 and coerces non-integers", () => {
    const raw = JSON.stringify({
      scores: [
        { dimension: "security", score: 15, rationale: "" },       // -> 10
        { dimension: "code_quality", score: -3, rationale: "" },   // -> 0
        { dimension: "documentation", score: 7.8, rationale: "" }, // -> 8 (rounds)
        { dimension: "reliability", score: 6.2, rationale: "" },   // -> 6
        { dimension: "permission_scope", score: 9, rationale: "" },
      ],
      findings: [],
    });
    const parsed = parseAuditJson(raw)!;
    const byDim = Object.fromEntries(parsed.scores.map((s) => [s.dimension, s.score]));
    expect(byDim.security).toBe(10);
    expect(byDim.code_quality).toBe(0);
    expect(byDim.documentation).toBe(8);
    expect(byDim.reliability).toBe(6);
    expect(byDim.permission_scope).toBe(9);
  });

  test("drops malformed findings but keeps well-formed ones", () => {
    const raw = JSON.stringify({
      scores: [
        { dimension: "security", score: 8, rationale: "" },
        { dimension: "code_quality", score: 8, rationale: "" },
        { dimension: "documentation", score: 8, rationale: "" },
        { dimension: "reliability", score: 8, rationale: "" },
        { dimension: "permission_scope", score: 8, rationale: "" },
      ],
      findings: [
        { dimension: "security", severity: "critical", message: "bad" },
        { dimension: "not_a_real_dim", severity: "warning", message: "drop me" },
        { dimension: "security", severity: "nope", message: "drop severity-wise too" },
        { dimension: "documentation", severity: "info", message: "" }, // empty message -> drop
      ],
    });
    const parsed = parseAuditJson(raw)!;
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]!.severity).toBe("critical");
  });

  test("returns null on non-JSON garbage", () => {
    expect(parseAuditJson("sorry, I cannot produce JSON today")).toBeNull();
  });

  test("returns null on a bare number with no JSON object braces", () => {
    // No `{`/`}` → the brace scan bails before JSON.parse runs.
    expect(parseAuditJson("123")).toBeNull();
  });

  test("returns null on a bare null with no JSON object braces", () => {
    expect(parseAuditJson("null")).toBeNull();
  });

  test("returns null when an object lacks a scores key", () => {
    // Parses to an object, but `scores` is undefined → not an array → null.
    expect(parseAuditJson('{ "x": 1 }')).toBeNull();
  });

  test("returns null when scores is not an array", () => {
    const raw = JSON.stringify({ scores: { nope: true }, findings: [] });
    expect(parseAuditJson(raw)).toBeNull();
  });

  test("skips score entries with a NaN score", () => {
    const raw = JSON.stringify({
      scores: [
        { dimension: "security", score: "not-a-number", rationale: "" }, // NaN → skipped
        { dimension: "code_quality", score: 8, rationale: "" },
        { dimension: "documentation", score: 8, rationale: "" },
        { dimension: "reliability", score: 8, rationale: "" },
        { dimension: "permission_scope", score: 8, rationale: "" },
      ],
      findings: [],
    });
    // security got skipped (NaN) → a required dimension is missing → null.
    expect(parseAuditJson(raw)).toBeNull();
  });

  test("treats a non-array findings field as empty", () => {
    const raw = JSON.stringify({
      scores: [
        { dimension: "security", score: 8, rationale: "" },
        { dimension: "code_quality", score: 8, rationale: "" },
        { dimension: "documentation", score: 8, rationale: "" },
        { dimension: "reliability", score: 8, rationale: "" },
        { dimension: "permission_scope", score: 8, rationale: "" },
      ],
      findings: "oops not an array",
    });
    const parsed = parseAuditJson(raw)!;
    expect(parsed).not.toBeNull();
    expect(parsed.findings).toEqual([]);
  });
});
