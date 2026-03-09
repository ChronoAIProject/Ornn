/**
 * Tests for frontmatterBuilder.
 * Covers nested metadata output, Claude fields, quoting, buildSkillMd.
 */

import { describe, it, expect } from "vitest";
import { buildFrontmatter, buildSkillMd } from "./frontmatterBuilder";
import { createDefaultSkillMetadata } from "@/types/skillPackage";

describe("buildFrontmatter", () => {
  it("build_plainSkill_emitsNestedMetadata", () => {
    const meta = createDefaultSkillMetadata({
      name: "my-skill",
      description: "A test skill",
      metadata: {
        category: "plain",
        runtime: [],
        runtimeDependency: [],
        runtimeEnvVar: [],
        toolList: [],
        tag: ["test"],
      },
    });

    const result = buildFrontmatter(meta);

    expect(result).toContain("name: my-skill");
    expect(result).toContain("description: A test skill");
    expect(result).toContain("metadata:");
    expect(result).toContain("  category: plain");
    expect(result).toContain("  tag:");
    expect(result).toContain("    - test");
    // Should not contain runtime/tools for plain
    expect(result).not.toContain("  runtime:");
    expect(result).not.toContain("  tool-list:");
  });

  it("build_runtimeBasedSkill_emitsRuntimeFields", () => {
    const meta = createDefaultSkillMetadata({
      name: "runtime-skill",
      description: "Has runtimes",
      metadata: {
        category: "runtime-based",
        runtime: ["node"],
        runtimeDependency: ["axios", "lodash"],
        runtimeEnvVar: ["API_KEY"],
        toolList: [],
        tag: [],
      },
    });

    const result = buildFrontmatter(meta);

    expect(result).toContain("  runtime:");
    expect(result).toContain("    - node");
    expect(result).toContain("  runtime-dependency:");
    expect(result).toContain("    - axios");
    expect(result).toContain("    - lodash");
    expect(result).toContain("  runtime-env-var:");
    expect(result).toContain("    - API_KEY");
  });

  it("build_toolBasedSkill_emitsToolList", () => {
    const meta = createDefaultSkillMetadata({
      name: "tool-skill",
      description: "Has tools",
      metadata: {
        category: "tool-based",
        runtime: [],
        runtimeDependency: [],
        runtimeEnvVar: [],
        toolList: ["Bash", "Write"],
        tag: [],
      },
    });

    const result = buildFrontmatter(meta);

    expect(result).toContain("  tool-list:");
    expect(result).toContain("    - Bash");
    expect(result).toContain("    - Write");
  });

  it("build_withClaudeFields_emitsOnlyNonDefault", () => {
    const meta = createDefaultSkillMetadata({
      name: "advanced",
      description: "Has Claude fields",
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ["Bash"],
      model: "claude-sonnet-4-20250514",
      agent: "my-agent",
      argumentHint: "provide a file",
      context: ["./src"],
    });

    const result = buildFrontmatter(meta);

    expect(result).toContain("disable-model-invocation: true");
    expect(result).toContain("user-invocable: false");
    expect(result).toContain("allowed-tools:");
    expect(result).toContain("  - Bash");
    expect(result).toContain("model: claude-sonnet-4-20250514");
    expect(result).toContain("agent: my-agent");
    expect(result).toContain("argument-hint: provide a file");
    expect(result).toContain("context:");
    expect(result).toContain("  - ./src");
  });

  it("build_withDefaults_omitsClaudeFields", () => {
    const meta = createDefaultSkillMetadata({
      name: "simple",
      description: "Basic skill",
    });

    const result = buildFrontmatter(meta);

    // Default values should not be emitted
    expect(result).not.toContain("disable-model-invocation");
    expect(result).not.toContain("user-invocable");
    expect(result).not.toContain("allowed-tools");
    expect(result).not.toContain("model:");
    expect(result).not.toContain("agent:");
  });

  it("build_withLicenseAndCompat_emits", () => {
    const meta = createDefaultSkillMetadata({
      name: "licensed",
      description: "Has license",
      license: "MIT",
      compatibility: "claude-code >= 1.0",
    });

    const result = buildFrontmatter(meta);

    expect(result).toContain("license: MIT");
    expect(result).toContain("compatibility: claude-code >= 1.0");
  });

  it("build_quotesSpecialChars_properly", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: 'Has "quotes" and \\backslash',
    });

    const result = buildFrontmatter(meta);

    // Plain YAML scalar — quotes and backslashes are literal
    expect(result).toContain('description: Has "quotes" and \\backslash');
  });

  it("build_quotesWhenNeeded_colonSpace", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: "Key: value pair inside",
    });

    const result = buildFrontmatter(meta);

    // Contains ': ' which needs quoting to avoid YAML ambiguity
    expect(result).toContain('description: "Key: value pair inside"');
  });

  it("build_quotesWhenNeeded_startsWithSpecialChar", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: "*bold style text",
    });

    const result = buildFrontmatter(meta);

    // Starts with * which is a YAML indicator
    expect(result).toContain('description: "*bold style text"');
  });

  it("build_startsAndEndsWith_dashes", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: "test",
    });

    const result = buildFrontmatter(meta);
    const lines = result.split("\n");

    expect(lines[0]).toBe("---");
    expect(lines[lines.length - 1]).toBe("---");
  });
});

describe("buildSkillMd", () => {
  it("build_combinesFrontmatterAndBody", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: "test",
    });

    const result = buildSkillMd(meta, "# Hello\n\nWorld");

    expect(result).toContain("---");
    expect(result).toContain("name: test");
    expect(result).toContain("# Hello\n\nWorld");
  });

  it("build_separatesFrontmatterFromBody_withBlankLine", () => {
    const meta = createDefaultSkillMetadata({
      name: "test",
      description: "test",
    });

    const result = buildSkillMd(meta, "# Body");
    // Should have frontmatter close + blank line + body
    expect(result).toContain("---\n\n# Body");
  });
});
