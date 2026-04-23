import { describe, test, expect } from "bun:test";
import { extractFrontmatter, validateFrontmatter } from "./frontmatter";

describe("extractFrontmatter", () => {
  test("newNestedFormat_returnsParsedObject", () => {
    const md = `---
name: my-skill
description: A test skill
metadata:
  category: "tool-based"
  tool-list:
    - Bash
    - Write
  tag:
    - test
---

# My Skill

Content here.`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    expect(result!.description).toBe("A test skill");
    const meta = result!.metadata as Record<string, unknown>;
    expect(meta.category).toBe("tool-based");
    expect(meta.toolList).toEqual(["Bash", "Write"]);
    expect(meta.tag).toEqual(["test"]);
  });

  test("oldFlatFormat_autoMappedToNested", () => {
    const md = `---
name: my-skill
description: A test skill
category: tools_required
tools:
  - Bash
  - Write
tags:
  - test
env:
  - API_KEY
dependencies:
  - lodash
---

# My Skill`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    // Flat fields are now in nested metadata
    const meta = result!.metadata as Record<string, unknown>;
    expect(meta.category).toBe("tool-based");
    expect(meta.toolList).toEqual(["Bash", "Write"]);
    expect(meta.tag).toEqual(["test"]);
    expect(meta.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(meta.runtimeDependency).toEqual(["lodash"]);
  });

  test("noFrontmatter_returnsNull", () => {
    const md = "# Just a heading\n\nNo frontmatter here.";
    expect(extractFrontmatter(md)).toBeNull();
  });

  test("invalidYaml_returnsNull", () => {
    const md = `---
: : : invalid yaml [[[
---

# Title`;
    expect(extractFrontmatter(md)).toBeNull();
  });

  test("emptyFrontmatter_returnsNull", () => {
    const md = `---

---

# Title`;
    expect(extractFrontmatter(md)).toBeNull();
  });

  test("hyphenatedKeys_mappedToCamelCase", () => {
    const md = `---
name: my-skill
description: A skill
disable-model-invocation: true
user-invocable: false
argument-hint: "Provide a path"
metadata:
  category: "plain"
---

# Title`;

    const result = extractFrontmatter(md);
    expect(result).not.toBeNull();
    expect(result!.disableModelInvocation).toBe(true);
    expect(result!.userInvocable).toBe(false);
    expect(result!.argumentHint).toBe("Provide a path");
  });
});

describe("validateFrontmatter", () => {
  test("validNewFormat_returnsNoErrors", () => {
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      version: "1.0",
      metadata: { category: "plain" },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data).toBeDefined();
  });

  test("validOldFlatFormat_autoMappedAndValid", () => {
    // Old flat format with category "imported" maps to "plain" which requires no extra fields.
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      version: "1.0",
      category: "imported",
    });
    expect(result.valid).toBe(true);
  });

  test("missingName_returnsStructuredError", () => {
    const result = validateFrontmatter({
      description: "A test",
      metadata: { category: "plain" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "name")).toBe(true);
  });

  test("missingDescription_returnsStructuredError", () => {
    const result = validateFrontmatter({
      name: "test-skill",
      metadata: { category: "plain" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "description")).toBe(true);
  });

  test("missingMetadata_noFlatFields_defaultsToPlain", () => {
    // When no metadata block and no flat fields, adapter creates default plain metadata
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      version: "1.0",
    });
    expect(result.valid).toBe(true);
    if (result.data) {
      expect(result.data.metadata.category).toBe("plain");
    }
  });

  test("missingVersion_returnsStructuredError", () => {
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      metadata: { category: "plain" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "version")).toBe(true);
  });

  test("invalidVersionFormat_3DigitSemver_returnsError", () => {
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      version: "1.0.0",
      metadata: { category: "plain" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "version")).toBe(true);
  });

  test("conditionalViolation_returnsFieldPath", () => {
    const result = validateFrontmatter({
      name: "test-skill",
      description: "A test",
      metadata: { category: "runtime-based" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "metadata.runtime")).toBe(true);
  });
});
