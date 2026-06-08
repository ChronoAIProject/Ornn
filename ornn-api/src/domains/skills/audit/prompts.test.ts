/**
 * Unit tests for the skill-audit LLM prompts (#873).
 *
 * Two contracts are pinned:
 *   - `buildAuditUserPrompt` interpolates every field it is given
 *     (skillName / version / metadataSummary / filesBundle) into the
 *     returned string, so the LLM receives the full package context.
 *   - `AUDIT_SYSTEM_PROMPT` names all five scoring dimensions. This is a
 *     STRUCTURAL assertion (the parser keys off these exact names) — we
 *     deliberately do NOT snapshot the whole literal so prose edits don't
 *     break the test.
 *
 * @module domains/skills/audit/prompts.test
 */

import { describe, expect, test } from "bun:test";
import { AUDIT_SYSTEM_PROMPT, buildAuditUserPrompt } from "./prompts";
import { AUDIT_DIMENSIONS } from "./types";

describe("buildAuditUserPrompt", () => {
  test("interpolates every supplied field into the prompt", () => {
    const out = buildAuditUserPrompt({
      skillName: "my-cool-skill",
      version: "2.3.4",
      metadataSummary: "category=devtools; runtimes=node; tags=a,b",
      filesBundle: "// FILE: SKILL.md\nHello world bundle marker",
    });

    expect(out).toContain("my-cool-skill");
    expect(out).toContain("2.3.4");
    expect(out).toContain("category=devtools; runtimes=node; tags=a,b");
    expect(out).toContain("// FILE: SKILL.md\nHello world bundle marker");
    // Section headers the model relies on are present.
    expect(out).toContain("## Identity");
    expect(out).toContain("## Metadata summary");
    expect(out).toContain("## Package files");
  });

  test("keeps empty fields as empty interpolations (no crash, no placeholder leak)", () => {
    const out = buildAuditUserPrompt({
      skillName: "",
      version: "",
      metadataSummary: "",
      filesBundle: "",
    });
    // The template still renders its labels even when values are blank.
    expect(out).toContain("- name: ");
    expect(out).toContain("- version: ");
    // No unreplaced template tokens.
    expect(out).not.toContain("${");
  });
});

describe("AUDIT_SYSTEM_PROMPT", () => {
  test("names all five scoring dimensions", () => {
    for (const dim of AUDIT_DIMENSIONS) {
      expect(AUDIT_SYSTEM_PROMPT).toContain(dim);
    }
  });

  test("documents the strict JSON output contract", () => {
    // The parser strips fences and expects `scores` + `findings` keys —
    // pin that the prompt actually instructs that shape.
    expect(AUDIT_SYSTEM_PROMPT).toContain('"scores"');
    expect(AUDIT_SYSTEM_PROMPT).toContain('"findings"');
    expect(AUDIT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });
});
