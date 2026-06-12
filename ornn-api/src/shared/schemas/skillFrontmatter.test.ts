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

describe("validateSkillFrontmatter — depends-on grammar (#968)", () => {
  const GUID = "11111111-2222-4333-8444-555555555555";

  test("accepts <name>@<major.minor>", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools@1.0"] } }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.metadata["depends-on"]).toEqual(["pdf-tools@1.0"]);
  });

  test("accepts <guid>@<major.minor>", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": [`${GUID}@2.3`] } }),
    );
    expect(r.success).toBe(true);
  });

  test("accepts <name>@<dist-tag>", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools@beta"] } }),
    );
    expect(r.success).toBe(true);
  });

  test("accepts <guid>@<dist-tag>", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": [`${GUID}@stable`] } }),
    );
    expect(r.success).toBe(true);
  });

  test("defaults to [] when omitted", () => {
    const r = validateSkillFrontmatter(base());
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.metadata["depends-on"]).toEqual([]);
  });

  test("rejects 3-digit semver (name@1.2.3)", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools@1.2.3"] } }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.depends-on.0")?.message ?? "";
    expect(msg).toContain("no semver ranges");
  });

  test("rejects caret range (name@^1.0)", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools@^1.0"] } }),
    );
    expect(r.success).toBe(false);
  });

  test("rejects tilde range (name@~1.0)", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools@~1.0"] } }),
    );
    expect(r.success).toBe(false);
  });

  test("rejects a bare name with no @version", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": ["pdf-tools"] } }),
    );
    expect(r.success).toBe(false);
  });

  test("rejects a self-reference by name", () => {
    const r = validateSkillFrontmatter(
      base({
        name: "qa-sample",
        metadata: { category: "plain", "depends-on": ["qa-sample@1.0"] },
      }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.depends-on.0")?.message ?? "";
    expect(msg).toContain("cannot depend on itself");
  });

  test("rejects more than 50 direct dependencies", () => {
    const deps = Array.from({ length: 51 }, (_, i) => `dep-${i}@1.0`);
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": deps } }),
    );
    expect(r.success).toBe(false);
  });

  test("rejects a null list item", () => {
    const r = validateSkillFrontmatter(
      base({ metadata: { category: "plain", "depends-on": [null] } }),
    );
    expect(r.success).toBe(false);
    if (r.success) return;
    const msg = r.errors.find((e) => e.field === "metadata.depends-on.0")?.message ?? "";
    expect(msg).toContain("depends-on entries must be non-empty");
  });
});
