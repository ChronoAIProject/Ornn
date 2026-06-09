/**
 * UT-KB-DISTILL-* — DeterministicKbDistiller + extractSections (#970).
 *
 * @module domains/assistant/kb/distiller.test
 */

import { describe, expect, it } from "bun:test";
import {
  DeterministicKbDistiller,
  extractSections,
  type KbSourceDoc,
} from "./distiller";
import { CHARS_PER_TOKEN, estimateTokens } from "./tokens";

const distiller = new DeterministicKbDistiller();

function repeat(token: string, times: number): string {
  return Array.from({ length: times }, () => token).join(" ");
}

describe("DeterministicKbDistiller", () => {
  it("UT-KB-DISTILL-001: concatenates sources in manifest order under titles", () => {
    const sources: KbSourceDoc[] = [
      { id: "a", title: "Alpha", text: "alpha body" },
      { id: "b", title: "Bravo", text: "bravo body" },
    ];
    const digest = distiller.distill(sources, { budgetTokens: 1_000 });
    expect(digest.text.indexOf("## Alpha")).toBeLessThan(
      digest.text.indexOf("## Bravo"),
    );
    expect(digest.text).toContain("alpha body");
    expect(digest.text).toContain("bravo body");
    expect(digest.sources.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("UT-KB-DISTILL-002: per-source cap clips an oversized doc", () => {
    // ~400 chars ≈ 100 tokens, cap to 10 tokens (~40 chars).
    const big = repeat("word", 80);
    const digest = distiller.distill(
      [{ id: "big", title: "Big", text: big, maxTokens: 10 }],
      { budgetTokens: 10_000 },
    );
    const stat = digest.sources[0]!;
    expect(stat.truncated).toBe(true);
    expect(stat.estimatedTokens).toBeLessThanOrEqual(10);
  });

  it("UT-KB-DISTILL-003: global budget clamps the whole digest", () => {
    const sources: KbSourceDoc[] = [
      { id: "a", title: "Alpha", text: repeat("aaaa", 200) },
      { id: "b", title: "Bravo", text: repeat("bbbb", 200) },
      { id: "c", title: "Charlie", text: repeat("cccc", 200) },
    ];
    const budgetTokens = 50;
    const digest = distiller.distill(sources, { budgetTokens });
    // Hard invariant: the produced grounding never exceeds the budget.
    expect(digest.estimatedTokens).toBeLessThanOrEqual(budgetTokens);
    expect(digest.text.length).toBeLessThanOrEqual(budgetTokens * CHARS_PER_TOKEN);
    expect(digest.budgetTokens).toBe(budgetTokens);
  });

  it("UT-KB-DISTILL-004: tail source dropped by global clamp is marked truncated", () => {
    const sources: KbSourceDoc[] = [
      { id: "a", title: "Alpha", text: repeat("aaaa", 100) },
      { id: "z", title: "Zulu", text: repeat("zzzz", 100) },
    ];
    // Budget only fits the first block — Zulu's content shouldn't survive.
    const digest = distiller.distill(sources, { budgetTokens: 30 });
    expect(digest.text).not.toContain("## Zulu");
    const zulu = digest.sources.find((s) => s.id === "z")!;
    expect(zulu.truncated).toBe(true);
  });

  it("UT-KB-DISTILL-005: deterministic — identical inputs yield identical output", () => {
    const sources: KbSourceDoc[] = [
      { id: "a", title: "Alpha", text: "one two three", maxTokens: 100 },
      { id: "b", title: "Bravo", text: "four five six" },
    ];
    const first = distiller.distill(sources, { budgetTokens: 500 });
    const second = distiller.distill(sources, { budgetTokens: 500 });
    expect(first.text).toBe(second.text);
    expect(first.estimatedTokens).toBe(second.estimatedTokens);
  });

  it("UT-KB-DISTILL-006: empty / whitespace source contributes nothing", () => {
    const digest = distiller.distill(
      [
        { id: "empty", title: "Empty", text: "   \n  " },
        { id: "real", title: "Real", text: "real content" },
      ],
      { budgetTokens: 1_000 },
    );
    expect(digest.text).not.toContain("## Empty");
    expect(digest.text).toContain("## Real");
    const empty = digest.sources.find((s) => s.id === "empty")!;
    expect(empty.chars).toBe(0);
  });

  it("UT-KB-DISTILL-007: estimatedTokens matches estimateTokens(text)", () => {
    const digest = distiller.distill(
      [{ id: "a", title: "A", text: "some grounding text here" }],
      { budgetTokens: 1_000 },
    );
    expect(digest.estimatedTokens).toBe(estimateTokens(digest.text));
  });

  it("UT-KB-DISTILL-008: generatedFrom defaults + honours override", () => {
    const def = distiller.distill([{ id: "a", title: "A", text: "x" }], {
      budgetTokens: 100,
    });
    expect(def.generatedFrom).toBe("DeterministicKbDistiller");
    const overridden = distiller.distill([{ id: "a", title: "A", text: "x" }], {
      budgetTokens: 100,
      generatedFrom: "custom-note",
    });
    expect(overridden.generatedFrom).toBe("custom-note");
  });
});

describe("extractSections", () => {
  const doc = [
    "# Title",
    "intro line",
    "",
    "## Keep Me",
    "kept body 1",
    "kept body 2",
    "",
    "### Nested Under Keep",
    "still kept (deeper heading)",
    "",
    "## Drop Me",
    "dropped body",
    "",
    "## Also Keep",
    "second kept body",
  ].join("\n");

  it("UT-KB-EXTRACT-001: keeps only named sections, in document order", () => {
    const out = extractSections(doc, ["Keep Me", "Also Keep"]);
    expect(out).toContain("## Keep Me");
    expect(out).toContain("kept body 1");
    expect(out).toContain("## Also Keep");
    expect(out).toContain("second kept body");
    expect(out).not.toContain("## Drop Me");
    expect(out).not.toContain("dropped body");
  });

  it("UT-KB-EXTRACT-002: a kept section includes its deeper subsections", () => {
    const out = extractSections(doc, ["Keep Me"]);
    expect(out).toContain("### Nested Under Keep");
    expect(out).toContain("still kept (deeper heading)");
    // …but stops at the next same-level heading.
    expect(out).not.toContain("## Drop Me");
  });

  it("UT-KB-EXTRACT-003: heading match is case-insensitive + trimmed", () => {
    const out = extractSections(doc, ["  keep me  "]);
    expect(out).toContain("kept body 1");
  });

  it("UT-KB-EXTRACT-004: unmatched headings degrade to empty, never throw", () => {
    expect(extractSections(doc, ["Does Not Exist"])).toBe("");
  });
});
