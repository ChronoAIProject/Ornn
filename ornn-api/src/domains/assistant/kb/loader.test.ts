/**
 * UT-KB-LOAD-* — AssistantKbLoader, token helpers, and a guard test on
 * the committed digest artifact (#970).
 *
 * @module domains/assistant/kb/loader.test
 */

import { describe, expect, it } from "bun:test";
import { AssistantKbLoader, stripMetadataBlock } from "./loader";
import {
  CHARS_PER_TOKEN,
  DEFAULT_KB_TOKEN_BUDGET,
  clampToTokenBudget,
  estimateTokens,
  resolveKbTokenBudget,
} from "./tokens";

describe("token helpers", () => {
  it("UT-KB-TOKEN-001: estimateTokens ~ chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(4))).toBe(1);
    expect(estimateTokens("a".repeat(5))).toBe(2);
  });

  it("UT-KB-TOKEN-002: clampToTokenBudget never exceeds budget", () => {
    const text = "word ".repeat(1_000);
    const { text: clipped, truncated } = clampToTokenBudget(text, 20);
    expect(truncated).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(20 * CHARS_PER_TOKEN);
  });

  it("UT-KB-TOKEN-003: under-budget text is returned untouched", () => {
    const { text, truncated } = clampToTokenBudget("short", 1_000);
    expect(text).toBe("short");
    expect(truncated).toBe(false);
  });

  it("UT-KB-TOKEN-004: resolveKbTokenBudget honours env, falls back on garbage", () => {
    expect(resolveKbTokenBudget({})).toBe(DEFAULT_KB_TOKEN_BUDGET);
    expect(resolveKbTokenBudget({ ASSISTANT_KB_TOKEN_BUDGET: "5000" })).toBe(5_000);
    expect(resolveKbTokenBudget({ ASSISTANT_KB_TOKEN_BUDGET: "nope" })).toBe(
      DEFAULT_KB_TOKEN_BUDGET,
    );
    expect(resolveKbTokenBudget({ ASSISTANT_KB_TOKEN_BUDGET: "-5" })).toBe(
      DEFAULT_KB_TOKEN_BUDGET,
    );
  });
});

describe("stripMetadataBlock", () => {
  it("UT-KB-LOAD-001: removes a single leading HTML comment block", () => {
    const raw = "<!--\n  meta: here\n-->\n\n## Body\n\ncontent";
    const out = stripMetadataBlock(raw);
    expect(out.startsWith("## Body")).toBe(true);
    expect(out).not.toContain("meta: here");
  });

  it("UT-KB-LOAD-002: leaves a digest without a header untouched", () => {
    const raw = "## Body\n\ncontent";
    expect(stripMetadataBlock(raw)).toBe(raw);
  });
});

describe("AssistantKbLoader", () => {
  const HEADER = "<!--\n meta\n-->\n\n";

  it("UT-KB-LOAD-003: loads, strips header, and caches (reads once)", () => {
    let reads = 0;
    const loader = new AssistantKbLoader({
      budgetTokens: 10_000,
      readDigest: () => {
        reads += 1;
        return `${HEADER}## Ornn\n\nOrnn is a skill-lifecycle API.`;
      },
    });
    const first = loader.load();
    const second = loader.load();
    expect(reads).toBe(1); // cached
    expect(first).toBe(second);
    expect(first.text.startsWith("## Ornn")).toBe(true);
    expect(first.text).not.toContain("meta");
    expect(first.estimatedTokens).toBe(estimateTokens(first.text));
    expect(first.truncated).toBe(false);
  });

  it("UT-KB-LOAD-004: budget enforcement — oversized artifact is clamped on load", () => {
    const body = "word ".repeat(5_000); // ~6250 tokens
    const loader = new AssistantKbLoader({
      budgetTokens: 100,
      readDigest: () => `${HEADER}${body}`,
    });
    const kb = loader.load();
    expect(kb.truncated).toBe(true);
    expect(kb.estimatedTokens).toBeLessThanOrEqual(100);
    expect(kb.text.length).toBeLessThanOrEqual(100 * CHARS_PER_TOKEN);
  });

  it("UT-KB-LOAD-005: read failure degrades to empty grounding (no throw)", () => {
    const loader = new AssistantKbLoader({
      readDigest: () => {
        throw new Error("ENOENT");
      },
    });
    const kb = loader.load();
    expect(kb.text).toBe("");
    expect(kb.estimatedTokens).toBe(0);
  });

  it("UT-KB-LOAD-006: invalidate() forces a re-read", () => {
    let reads = 0;
    const loader = new AssistantKbLoader({
      readDigest: () => {
        reads += 1;
        return `${HEADER}content`;
      },
    });
    loader.load();
    loader.invalidate();
    loader.load();
    expect(reads).toBe(2);
  });
});
