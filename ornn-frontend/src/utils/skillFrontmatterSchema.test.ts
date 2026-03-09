/**
 * Tests for skillFrontmatterSchema.
 * Covers all 4 categories with valid/invalid conditional combos and edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  validateSkillFrontmatter,
  metadataSchema,
  skillFrontmatterSchema,
  FRONTMATTER_CATEGORIES,
} from "./skillFrontmatterSchema";

// --- helpers ---

function validBase() {
  return {
    name: "my-skill",
    description: "A test skill description",
  };
}

function validPlain() {
  return {
    ...validBase(),
    metadata: { category: "plain" as const, tag: ["test"] },
  };
}

function validToolBased() {
  return {
    ...validBase(),
    metadata: {
      category: "tool-based" as const,
      toolList: ["Bash"],
      tag: ["test"],
    },
  };
}

function validRuntimeBased() {
  return {
    ...validBase(),
    metadata: {
      category: "runtime-based" as const,
      runtime: ["node"],
      tag: ["test"],
    },
  };
}

function validMixed() {
  return {
    ...validBase(),
    metadata: {
      category: "mixed" as const,
      runtime: ["node"],
      toolList: ["Bash"],
      tag: ["test"],
    },
  };
}

// --- Tests ---

describe("skillFrontmatterSchema", () => {
  describe("constants", () => {
    it("exports_frontmatterCategories_containsFourValues", () => {
      expect(FRONTMATTER_CATEGORIES).toEqual([
        "plain",
        "tool-based",
        "runtime-based",
        "mixed",
      ]);
    });
  });

  describe("valid_inputs", () => {
    it("parse_plainCategory_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse(validPlain());
      expect(result.success).toBe(true);
    });

    it("parse_toolBasedCategory_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse(validToolBased());
      expect(result.success).toBe(true);
    });

    it("parse_runtimeBasedCategory_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse(validRuntimeBased());
      expect(result.success).toBe(true);
    });

    it("parse_mixedCategory_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse(validMixed());
      expect(result.success).toBe(true);
    });

    it("parse_withOptionalClaudeFields_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        disableModelInvocation: true,
        userInvocable: false,
        allowedTools: ["Bash"],
        model: "claude-sonnet-4-20250514",
        context: ["./src"],
        agent: "my-agent",
        argumentHint: "provide a file path",
        hooks: { beforeRun: "echo hello" },
        license: "MIT",
        compatibility: "claude-code >= 1.0",
      });
      expect(result.success).toBe(true);
    });

    it("parse_runtimeBasedWithOptionalFields_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "runtime-based",
          runtime: ["node"],
          runtimeDependency: ["axios", "lodash"],
          runtimeEnvVar: ["API_KEY", "SECRET_TOKEN"],
          tag: [],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("name_validation", () => {
    it("parse_emptyName_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        name: "",
      });
      expect(result.success).toBe(false);
    });

    it("parse_nameTooLong_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        name: "a".repeat(65),
      });
      expect(result.success).toBe(false);
    });

    it("parse_nameStartsWithHyphen_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        name: "-invalid-name",
      });
      expect(result.success).toBe(false);
    });

    it("parse_nameWithUppercase_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        name: "My-Skill",
      });
      expect(result.success).toBe(false);
    });

    it("parse_nameAtMaxLength_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validPlain(),
        name: "a".repeat(64),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("conditional_rules_plain", () => {
    it("parse_plainWithRuntime_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "plain",
          runtime: ["node"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_plainWithToolList_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "plain",
          toolList: ["Bash"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_plainWithRuntimeDependency_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "plain",
          runtimeDependency: ["axios"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_plainWithRuntimeEnvVar_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "plain",
          runtimeEnvVar: ["API_KEY"],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("conditional_rules_toolBased", () => {
    it("parse_toolBasedWithoutToolList_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "tool-based",
          toolList: [],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_toolBasedWithRuntime_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "tool-based",
          toolList: ["Bash"],
          runtime: ["node"],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("conditional_rules_runtimeBased", () => {
    it("parse_runtimeBasedWithoutRuntime_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "runtime-based",
          runtime: [],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_runtimeBasedWithToolList_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "runtime-based",
          runtime: ["node"],
          toolList: ["Bash"],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("conditional_rules_mixed", () => {
    it("parse_mixedWithoutRuntime_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "mixed",
          runtime: [],
          toolList: ["Bash"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_mixedWithoutToolList_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "mixed",
          runtime: ["node"],
          toolList: [],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_mixedWithBoth_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse(validMixed());
      expect(result.success).toBe(true);
    });
  });

  describe("envVar_validation", () => {
    it("parse_lowercaseEnvVar_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "runtime-based",
          runtime: ["node"],
          runtimeEnvVar: ["api_key"],
        },
      });
      expect(result.success).toBe(false);
    });

    it("parse_validUppercaseEnvVar_succeeds", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: {
          category: "runtime-based",
          runtime: ["node"],
          runtimeEnvVar: ["API_KEY", "SECRET_123"],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("tag_validation", () => {
    it("parse_tooManyTags_fails", () => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: { category: "plain", tag: tags },
      });
      expect(result.success).toBe(false);
    });

    it("parse_tagTooLong_fails", () => {
      const result = skillFrontmatterSchema.safeParse({
        ...validBase(),
        metadata: { category: "plain", tag: ["a".repeat(31)] },
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("validateSkillFrontmatter", () => {
  it("validate_validData_returnsSuccess", () => {
    const result = validateSkillFrontmatter(validPlain());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-skill");
    }
  });

  it("validate_invalidData_returnsErrors", () => {
    const result = validateSkillFrontmatter({
      name: "",
      description: "",
      metadata: { category: "plain" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBeTruthy();
      expect(result.errors[0].message).toBeTruthy();
    }
  });

  it("validate_conditionalViolation_returnsFieldPath", () => {
    const result = validateSkillFrontmatter({
      ...validBase(),
      metadata: {
        category: "runtime-based",
        runtime: [],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const runtimeError = result.errors.find(
        (e) => e.field === "metadata.runtime",
      );
      expect(runtimeError).toBeDefined();
      expect(runtimeError!.message).toContain("runtime is required");
    }
  });

  it("validate_defaults_appliedCorrectly", () => {
    const result = validateSkillFrontmatter(validPlain());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disableModelInvocation).toBe(false);
      expect(result.data.userInvocable).toBe(true);
      expect(result.data.metadata.runtime).toEqual([]);
      expect(result.data.metadata.toolList).toEqual([]);
    }
  });
});

describe("metadataSchema", () => {
  it("parse_minimalValid_succeeds", () => {
    const result = metadataSchema.safeParse({ category: "plain" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runtime).toEqual([]);
      expect(result.data.runtimeDependency).toEqual([]);
      expect(result.data.runtimeEnvVar).toEqual([]);
      expect(result.data.toolList).toEqual([]);
      expect(result.data.tag).toEqual([]);
    }
  });

  it("parse_invalidCategory_fails", () => {
    const result = metadataSchema.safeParse({ category: "unknown" });
    expect(result.success).toBe(false);
  });
});
