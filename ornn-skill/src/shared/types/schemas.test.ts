import { describe, test, expect } from "bun:test";
import {
  skillCreateSchema,
  skillUpdateSchema,
  generateQuerySchema,
  refineSchema,
} from "./schemas";

describe("skillCreateSchema", () => {
  const validBase = {
    name: "my-skill",
    description: "A test skill",
    metadata: { category: "plain" as const },
  };

  test("authorName_optional_defaultsUndefined", () => {
    const result = skillCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorName).toBeUndefined();
    }
  });

  test("authorName_provided_passesThrough", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      authorName: "test-author",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.authorName).toBe("test-author");
    }
  });

  test("version_optional_defaultsTo1", () => {
    const result = skillCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1");
    }
  });

  test("version_provided_usesProvidedValue", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      version: "2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("2");
    }
  });

  test("metadata_toolList_withToolBasedCategory_passes", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      metadata: { category: "tool-based", toolList: ["Bash", "Write"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.toolList).toEqual(["Bash", "Write"]);
    }
  });

  test("metadata_runtime_withRuntimeBasedCategory_passes", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      metadata: { category: "runtime-based", runtime: ["node"] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.runtime).toEqual(["node"]);
    }
  });

  test("metadata_conditionalValidation_toolBasedMissingTools_fails", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      metadata: { category: "tool-based" },
    });
    expect(result.success).toBe(false);
  });

  test("skillMd_optional", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      skillMd: "---\nname: test\n---\n# Test",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skillMd).toBe("---\nname: test\n---\n# Test");
    }
  });

  test("repoUrl_stillOptional_backwardCompat", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      repoUrl: "https://github.com/user/repo",
    });
    expect(result.success).toBe(true);
  });

  test("name_invalidFormat_fails", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      name: "Invalid Name",
    });
    expect(result.success).toBe(false);
  });

  test("name_startsWithHyphen_fails", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      name: "-invalid",
    });
    expect(result.success).toBe(false);
  });

  test("name_max64chars", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      name: "a".repeat(65),
    });
    expect(result.success).toBe(false);
  });

  test("claudeFields_disableModelInvocation_defaultsFalse", () => {
    const result = skillCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.disableModelInvocation).toBe(false);
    }
  });

  test("claudeFields_userInvocable_defaultsTrue", () => {
    const result = skillCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.userInvocable).toBe(true);
    }
  });

  test("ornnExtensions_license_passes", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      license: "MIT",
    });
    expect(result.success).toBe(true);
  });

  test("ornnExtensions_compatibility_passes", () => {
    const result = skillCreateSchema.safeParse({
      ...validBase,
      compatibility: "Claude 3.5+",
    });
    expect(result.success).toBe(true);
  });
});

describe("skillUpdateSchema", () => {
  test("emptyObject_passes", () => {
    const result = skillUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("metadata_optional_passes", () => {
    const result = skillUpdateSchema.safeParse({
      metadata: { category: "plain" },
    });
    expect(result.success).toBe(true);
  });

  test("claudeFields_optional_passes", () => {
    const result = skillUpdateSchema.safeParse({
      disableModelInvocation: true,
      userInvocable: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("generateQuerySchema", () => {
  test("validQuery_passes", () => {
    const result = generateQuerySchema.safeParse({ query: "Create a PDF parser skill" });
    expect(result.success).toBe(true);
  });

  test("emptyQuery_fails", () => {
    const result = generateQuerySchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  test("queryTooLong_fails", () => {
    const result = generateQuerySchema.safeParse({ query: "x".repeat(2001) });
    expect(result.success).toBe(false);
  });

  test("missingQuery_fails", () => {
    const result = generateQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("refineSchema", () => {
  test("validInput_passes", () => {
    const result = refineSchema.safeParse({
      conversationHistory: [
        { role: "user", content: "Create a skill" },
        { role: "assistant", content: '{"name": "test"}' },
      ],
      instruction: "Add error handling",
    });
    expect(result.success).toBe(true);
  });

  test("emptyInstruction_fails", () => {
    const result = refineSchema.safeParse({
      conversationHistory: [],
      instruction: "",
    });
    expect(result.success).toBe(false);
  });

  test("invalidRole_fails", () => {
    const result = refineSchema.safeParse({
      conversationHistory: [
        { role: "system", content: "test" },
      ],
      instruction: "Add feature",
    });
    expect(result.success).toBe(false);
  });

  test("instructionTooLong_fails", () => {
    const result = refineSchema.safeParse({
      conversationHistory: [],
      instruction: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  test("emptyConversationHistory_passes", () => {
    const result = refineSchema.safeParse({
      conversationHistory: [],
      instruction: "Start fresh",
    });
    expect(result.success).toBe(true);
  });
});
