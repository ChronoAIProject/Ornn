/**
 * Tests for the actionable `invalid_type` callbacks added for #649.
 *
 * The frontend schema mirrors the backend's
 * `ornn-api/src/shared/schemas/skillFrontmatter.ts` so users see the same
 * "write `version: \"0.1\"`, not `version: 0.1`" message regardless of
 * whether the frontmatter is rejected by the SPA's pre-validator or by
 * the backend. PR #672 landed the backend half; this file pins the
 * frontend half so future Zod refactors don't silently drop the
 * actionable copy.
 *
 * Each branch parses a frontmatter payload where one field carries a
 * non-string YAML primitive (number / null), then asserts the returned
 * `messageKey` is the *Invalid type* i18n key (not `versionFormat`,
 * `tagFormat`, etc — those fire for wrong-shape *strings*, which is a
 * different code path).
 */

import { describe, expect, test } from "vitest";
import { validateSkillFrontmatter } from "./skillFrontmatterSchema";

/** Build a valid `plain` frontmatter shape we can mutate per-test. */
function basePayload() {
  return {
    name: "my-skill",
    description: "A description.",
    version: "0.1",
    metadata: {
      category: "plain",
    },
  };
}

describe("frontmatter schema — invalid_type actionable messages (#649)", () => {
  test("version: 0.1 (unquoted, YAML → number) surfaces versionInvalidType", () => {
    const payload = basePayload();
    // YAML `version: 0.1` lands here as a number, not a string.
    (payload as unknown as { version: number }).version = 0.1;

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const versionErr = result.errors.find((e) => e.field === "version");
    expect(versionErr).toBeDefined();
    expect(versionErr?.messageKey).toBe(
      "errors.frontmatter.versionInvalidType",
    );
    // Should NOT degrade to the generic catch-all.
    expect(versionErr?.messageKey).not.toBe("errors.frontmatter.generic");
  });

  test("tag: [null] (empty `- ` YAML line) surfaces tagInvalidType", () => {
    const payload = basePayload();
    (payload.metadata as Record<string, unknown>).tag = [null];

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const tagErr = result.errors.find((e) => e.field.startsWith("metadata.tag"));
    expect(tagErr?.messageKey).toBe("errors.frontmatter.tagInvalidType");
  });

  test("runtime-env-var: [null] surfaces envVarInvalidType (category: mixed)", () => {
    // env-var is only allowed for runtime-based/mixed categories, so flip
    // to mixed for this branch and supply the other required fields.
    const payload = basePayload();
    payload.metadata = {
      category: "mixed",
      runtime: ["python"],
      toolList: ["Bash"],
      outputType: "text",
      runtimeEnvVar: [null],
    } as unknown as typeof payload.metadata;

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const envErr = result.errors.find((e) =>
      e.field.startsWith("metadata.runtimeEnvVar"),
    );
    expect(envErr?.messageKey).toBe("errors.frontmatter.envVarInvalidType");
  });

  test("tool-list: [null] surfaces toolInvalidType (category: tool-based)", () => {
    const payload = basePayload();
    payload.metadata = {
      category: "tool-based",
      toolList: [null],
    } as unknown as typeof payload.metadata;

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const toolErr = result.errors.find((e) =>
      e.field.startsWith("metadata.toolList"),
    );
    expect(toolErr?.messageKey).toBe("errors.frontmatter.toolInvalidType");
  });

  test("runtime: [null] surfaces runtimeInvalidType (category: runtime-based)", () => {
    const payload = basePayload();
    payload.metadata = {
      category: "runtime-based",
      runtime: [null],
      outputType: "text",
    } as unknown as typeof payload.metadata;

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const rtErr = result.errors.find((e) =>
      e.field.startsWith("metadata.runtime"),
    );
    expect(rtErr?.messageKey).toBe("errors.frontmatter.runtimeInvalidType");
  });

  test("runtime-dependency: [null] surfaces dependencyInvalidType", () => {
    const payload = basePayload();
    payload.metadata = {
      category: "runtime-based",
      runtime: ["python"],
      outputType: "text",
      runtimeDependency: [null],
    } as unknown as typeof payload.metadata;

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const depErr = result.errors.find((e) =>
      e.field.startsWith("metadata.runtimeDependency"),
    );
    expect(depErr?.messageKey).toBe(
      "errors.frontmatter.dependencyInvalidType",
    );
  });
});

describe("frontmatter schema — pre-existing string-shape errors still fire (#649 regression guard)", () => {
  test('version: "1" (string, wrong shape) still uses versionFormat, not versionInvalidType', () => {
    const payload = basePayload();
    payload.version = "1"; // wrong shape but right type.

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const versionErr = result.errors.find((e) => e.field === "version");
    expect(versionErr?.messageKey).toBe("errors.frontmatter.versionFormat");
  });

  test('tag: ["UPPER"] (string, wrong format) still uses tagFormat', () => {
    const payload = basePayload();
    (payload.metadata as Record<string, unknown>).tag = ["UPPER"];

    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(false);
    if (result.success) return;

    const tagErr = result.errors.find((e) => e.field.startsWith("metadata.tag"));
    expect(tagErr?.messageKey).toBe("errors.frontmatter.tagFormat");
  });

  test("happy path: valid plain skill parses cleanly", () => {
    const payload = basePayload();
    const result = validateSkillFrontmatter(payload);
    expect(result.success).toBe(true);
  });
});
