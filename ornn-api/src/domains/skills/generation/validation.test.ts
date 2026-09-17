/**
 * Unit tests for the generated-skill validator (#1242).
 *
 * The parse/clean cases (fence strip / brace slice / readmeMd migration
 * / schema-fail / non-JSON) moved here from `service.test.ts` when the
 * routine left the service. The mode cases pin the package-shape rule:
 * `advanced` accepts every schema-valid answer, `simple` rejects any
 * answer that carries files or runtime fields with a `mode_violation`
 * that names the offending fields.
 *
 * @module domains/skills/generation/validation.test
 */

import { describe, expect, test } from "bun:test";
import {
  findSimpleModeViolations,
  parseGeneratedSkill,
  validateGeneratedSkill,
} from "./validation";

/** A schema-valid, SKILL.md-only skill document. */
const PLAIN = {
  name: "demo-skill",
  description: "A perfectly valid demo skill for testing purposes.",
  category: "plain",
  tags: ["demo", "test"],
  readmeBody:
    "# Demo Skill\n\nThis readme body is comfortably over the fifty character minimum length.",
  runtimes: [],
  dependencies: [],
  envVars: [],
  scripts: [],
};
const PLAIN_JSON = JSON.stringify(PLAIN);

/** Schema-valid, carries every advanced-mode field. */
const SCRIPTED = {
  ...PLAIN,
  name: "scripted-skill",
  category: "runtime-based",
  outputType: "text",
  runtimes: ["node"],
  dependencies: ["axios"],
  envVars: ["API_KEY"],
  scripts: [{ filename: "main.js", content: "console.log('hi')" }],
  references: [{ filename: "notes.md", content: "# Notes" }],
  assets: [{ filename: "sample.csv", content: "a,b\n1,2" }],
};
const SCRIPTED_JSON = JSON.stringify(SCRIPTED);

// ---- parseGeneratedSkill --------------------------------------------

describe("parseGeneratedSkill", () => {
  test("strips a ```json fence", () => {
    const out = parseGeneratedSkill("```json\n" + PLAIN_JSON + "\n```");
    expect(out).not.toBeNull();
    expect(out!.name).toBe("demo-skill");
  });

  test("strips a bare ``` fence", () => {
    expect(parseGeneratedSkill("```\n" + PLAIN_JSON + "\n```")).not.toBeNull();
  });

  test("slices the brace span out of prose-wrapped output", () => {
    const out = parseGeneratedSkill(
      "Sure! Here is your skill:\n" + PLAIN_JSON + "\nHope that helps.",
    );
    expect(out).not.toBeNull();
    expect(out!.name).toBe("demo-skill");
  });

  test("migrates readmeMd → readmeBody, stripping YAML frontmatter", () => {
    const withFrontmatter = JSON.stringify({
      name: "legacy-skill",
      description: "A legacy skill carrying readmeMd with frontmatter.",
      category: "plain",
      tags: ["legacy"],
      readmeMd:
        "---\ntitle: Legacy\nfoo: bar\n---\n# Legacy Skill\n\nBody content that is well over the fifty character minimum requirement.",
    });
    const out = parseGeneratedSkill(withFrontmatter);
    expect(out).not.toBeNull();
    expect(out!.readmeBody).toContain("# Legacy Skill");
    expect(out!.readmeBody).not.toContain("title: Legacy");
  });

  test("migrates readmeMd → readmeBody when there is no frontmatter", () => {
    const noFrontmatter = JSON.stringify({
      name: "legacy-plain",
      description: "A legacy skill carrying readmeMd without frontmatter.",
      category: "plain",
      tags: ["legacy"],
      readmeMd:
        "# Plain Legacy\n\nThis body has no YAML frontmatter and is over the fifty char minimum.",
    });
    const out = parseGeneratedSkill(noFrontmatter);
    expect(out).not.toBeNull();
    expect(out!.readmeBody).toContain("# Plain Legacy");
  });

  test("schema violation returns null", () => {
    const badSchema = JSON.stringify({
      name: "Bad Name With Spaces",
      description: "short",
      category: "plain",
      tags: [],
      readmeBody: "too short",
    });
    expect(parseGeneratedSkill(badSchema)).toBeNull();
  });

  test("non-JSON input returns null", () => {
    expect(parseGeneratedSkill("this is not json at all")).toBeNull();
  });

  test("references / assets default to [] when the model omits them", () => {
    const out = parseGeneratedSkill(PLAIN_JSON);
    expect(out!.references).toEqual([]);
    expect(out!.assets).toEqual([]);
  });

  test("references / assets pass through when the model emits them", () => {
    const out = parseGeneratedSkill(SCRIPTED_JSON);
    expect(out!.references).toEqual([{ filename: "notes.md", content: "# Notes" }]);
    expect(out!.assets[0]!.filename).toBe("sample.csv");
  });

  test("a references entry with empty content fails the schema", () => {
    const bad = JSON.stringify({
      ...PLAIN,
      references: [{ filename: "empty.md", content: "" }],
    });
    expect(parseGeneratedSkill(bad)).toBeNull();
  });
});

// ---- findSimpleModeViolations ----------------------------------------

describe("findSimpleModeViolations", () => {
  test("a plain SKILL.md-only skill has no violations", () => {
    expect(findSimpleModeViolations(parseGeneratedSkill(PLAIN_JSON)!)).toEqual([]);
  });

  test("names every offending field, category first", () => {
    expect(findSimpleModeViolations(parseGeneratedSkill(SCRIPTED_JSON)!)).toEqual([
      "category",
      "outputType",
      "scripts",
      "references",
      "assets",
      "runtimes",
      "dependencies",
      "envVars",
    ]);
  });

  test("a plain skill with only references is still a violation", () => {
    const skill = parseGeneratedSkill(
      JSON.stringify({ ...PLAIN, references: [{ filename: "r.md", content: "ref" }] }),
    )!;
    expect(findSimpleModeViolations(skill)).toEqual(["references"]);
  });

  test("a stray outputType on a plain skill is a violation (frontmatter would reject it)", () => {
    const skill = parseGeneratedSkill(JSON.stringify({ ...PLAIN, outputType: "text" }))!;
    expect(findSimpleModeViolations(skill)).toEqual(["outputType"]);
  });

  test("works on a raw parsed object that would fail the schema", () => {
    // description too short, tag uppercase — but it still carries files.
    const raw = { description: "x", tags: ["Bad"], scripts: [{ filename: "a.js", content: "1" }] };
    expect(findSimpleModeViolations(raw)).toEqual(["scripts"]);
  });

  test("ignores empty arrays and a missing category on a raw object", () => {
    expect(findSimpleModeViolations({ scripts: [], references: [] })).toEqual([]);
  });
});

// ---- validateGeneratedSkill ------------------------------------------

describe("validateGeneratedSkill", () => {
  test("advanced accepts a scripted answer", () => {
    const r = validateGeneratedSkill(SCRIPTED_JSON, "advanced");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skill.name).toBe("scripted-skill");
  });

  test("advanced accepts a plain answer", () => {
    expect(validateGeneratedSkill(PLAIN_JSON, "advanced").ok).toBe(true);
  });

  test("simple accepts a plain SKILL.md-only answer", () => {
    expect(validateGeneratedSkill(PLAIN_JSON, "simple").ok).toBe(true);
  });

  test("simple rejects a scripted answer as mode_violation naming the fields", () => {
    const r = validateGeneratedSkill(SCRIPTED_JSON, "simple");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("mode_violation");
      expect(r.violations).toContain("scripts");
      expect(r.violations).toContain("references");
      expect(r.message).toContain("Simple mode allows SKILL.md only");
      expect(r.message).toContain("scripts");
    }
  });

  test("simple rejects a plain answer that sneaks in an asset", () => {
    const r = validateGeneratedSkill(
      JSON.stringify({ ...PLAIN, assets: [{ filename: "t.json", content: "{}" }] }),
      "simple",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toEqual(["assets"]);
  });

  test("invalid JSON is reported as invalid_json in either mode", () => {
    for (const mode of ["simple", "advanced"] as const) {
      const r = validateGeneratedSkill("nope", mode);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("invalid_json");
        expect(r.violations).toEqual([]);
      }
    }
  });

  test("simple: a schema-invalid answer that still carries files is a mode_violation, not schema", () => {
    // The multi-turn path delivers `schema` rejections verbatim (prose is
    // allowed there), so a files-carrying answer must be classified as a
    // mode violation regardless of the other schema rules it breaks.
    for (const doc of [
      { ...SCRIPTED, name: "Bad Name" },
      { ...SCRIPTED, description: "x" },
      { ...SCRIPTED, tags: ["Demo"] },
      { description: "short", category: "runtime-based", scripts: [{ filename: "a.js", content: "1" }] },
    ]) {
      const r = validateGeneratedSkill(JSON.stringify(doc), "simple");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).toBe("mode_violation");
        expect(r.violations).toContain("scripts");
      }
    }
  });

  test("simple: a schema-invalid answer WITHOUT files is reported as schema", () => {
    const r = validateGeneratedSkill(JSON.stringify({ ...PLAIN, name: "Bad Name" }), "simple");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema");
  });

  test("advanced: a schema-invalid scripted answer is reported as schema", () => {
    const r = validateGeneratedSkill(JSON.stringify({ ...SCRIPTED, name: "Bad Name" }), "advanced");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("schema");
  });

  test("simple: outputType on an otherwise plain answer is a mode_violation", () => {
    const r = validateGeneratedSkill(JSON.stringify({ ...PLAIN, outputType: "text" }), "simple");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toEqual(["outputType"]);
  });

  test("JSON that is null, an empty array or a scalar is invalid_json, never a throw", () => {
    // (An array that CONTAINS an object is sliced down to that object by
    // the brace-span cleanup — legacy behaviour, exercised elsewhere.)
    for (const raw of ["null", "[]", "42", "\"str\"", "true"]) {
      for (const mode of ["simple", "advanced"] as const) {
        const r = validateGeneratedSkill(raw, mode);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toBe("invalid_json");
      }
      expect(parseGeneratedSkill(raw)).toBeNull();
    }
  });

  test("a non-string readmeMd is left to the schema instead of throwing", () => {
    for (const readmeMd of [null, 42, { nested: true }]) {
      const doc = { ...PLAIN, readmeBody: undefined, readmeMd };
      const r = validateGeneratedSkill(JSON.stringify(doc), "advanced");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("schema");
      expect(parseGeneratedSkill(JSON.stringify(doc))).toBeNull();
    }
  });
});
