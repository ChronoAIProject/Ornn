/**
 * SkillFrontmatter schema tests — pins the #649 actionable-error
 * contract.
 *
 * These cases reproduce common user mistakes (unquoted YAML version,
 * empty `- ` list items, bad regex shapes) and assert that the schema
 * returns a message that tells the user *what to write instead*, not
 * just "Invalid input".
 *
 * @module shared/schemas/skillFrontmatter.test
 */

import { describe, expect, test } from "bun:test";
import { validateSkillFrontmatter } from "./skillFrontmatter";

function base(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "qa-sample",
    description: "Sample description that is long enough",
    version: "0.1",
    metadata: { category: "plain", tag: ["qa"] },
    ...overrides,
  };
}

describe("validateSkillFrontmatter — actionable errors (#649)", () => {
  test("unquoted numeric version → explains the YAML quoting trap", () => {
    const r = validateSkillFrontmatter(base({ version: 0.1 }));
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "version")?.message ?? "";
    expect(msg).toContain("quoted string");
    expect(msg).toContain('version: "0.1"');
  });

  test("null tag (empty `- ` list item) → explains tag shape", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", tag: [null] } }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.tag.0")?.message ?? "";
    expect(msg).toContain("non-empty lowercase strings");
    expect(msg).toContain("`tag: [my-tag]`");
    expect(msg).not.toMatch(/^Invalid input$/);
  });

  test("uppercase tag → existing regex message is preserved", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", tag: ["QA"] } }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.tag.0")?.message ?? "";
    expect(msg).toContain("lowercase alphanumeric with hyphens");
  });

  test("null env var → explains UPPER_SNAKE_CASE shape", () => {
    const r = validateSkillFrontmatter(
      base({
        metadata: {
          category: "runtime-based",
          "output-type": "text",
          runtime: ["python"],
          "runtime-env-var": [null],
        },
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.runtime-env-var.0")?.message ?? "";
    expect(msg).toContain("UPPER_SNAKE_CASE");
    expect(msg).toContain("OPENAI_API_KEY");
  });

  test("null runtime entry → actionable message", () => {
    const r = validateSkillFrontmatter(
      base({
        metadata: {
          category: "runtime-based",
          "output-type": "text",
          runtime: [null],
        },
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.runtime.0")?.message ?? "";
    expect(msg).toContain("`runtime: [python]`");
  });

  test("null tool entry → actionable message", () => {
    const r = validateSkillFrontmatter(
      base({
        metadata: { category: "tool-based", "tool-list": [null] },
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.tool-list.0")?.message ?? "";
    expect(msg).toContain("`tool-list: [Bash, Read]`");
  });

  test("null dependency entry → actionable message", () => {
    const r = validateSkillFrontmatter(
      base({
        metadata: {
          category: "runtime-based",
          "output-type": "text",
          runtime: ["python"],
          "runtime-dependency": [null],
        },
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.runtime-dependency.0")?.message ?? "";
    expect(msg).toContain("`runtime-dependency: [requests==2.31]`");
  });

  test("valid frontmatter still parses cleanly", () => {
    const r = validateSkillFrontmatter(base());
    expect(r.success).toBe(true);
  });
});
