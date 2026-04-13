import { describe, test, expect } from "bun:test";
import {
  adaptOldFrontmatter,
  mapOldCategory,
  adaptApiRequest,
  yamlKeysToCamel,
  camelKeysToYaml,
} from "./frontmatterAdapter";

// ============================================================================
// mapOldCategory
// ============================================================================

describe("mapOldCategory", () => {
  test("toolsRequired_mapsToToolBased", () => {
    expect(mapOldCategory("tools_required")).toBe("tool-based");
  });

  test("runtimeRequired_mapsToRuntimeBased", () => {
    expect(mapOldCategory("runtime_required")).toBe("runtime-based");
  });

  test("imported_mapsToPlain", () => {
    expect(mapOldCategory("imported")).toBe("plain");
  });

  test("plain_passesThrough", () => {
    expect(mapOldCategory("plain")).toBe("plain");
  });

  test("mixed_passesThrough", () => {
    expect(mapOldCategory("mixed")).toBe("mixed");
  });

  test("toolBased_passesThrough", () => {
    expect(mapOldCategory("tool-based")).toBe("tool-based");
  });

  test("runtimeBased_passesThrough", () => {
    expect(mapOldCategory("runtime-based")).toBe("runtime-based");
  });

  test("undefined_defaultsToPlain", () => {
    expect(mapOldCategory(undefined)).toBe("plain");
  });

  test("emptyString_defaultsToPlain", () => {
    expect(mapOldCategory("")).toBe("plain");
  });
});

// ============================================================================
// adaptOldFrontmatter
// ============================================================================

describe("adaptOldFrontmatter", () => {
  test("alreadyNested_passesThrough", () => {
    const input = {
      name: "my-skill",
      metadata: { category: "plain" },
    };
    const result = adaptOldFrontmatter(input);
    expect(result).toEqual(input);
  });

  test("flatFrontmatter_mapsToNested", () => {
    const input = {
      name: "my-skill",
      description: "A skill",
      category: "tools_required",
      tools: ["Bash", "Read"],
      runtimes: [],
      tags: ["test"],
      env: ["API_KEY"],
      dependencies: ["axios"],
    };
    const result = adaptOldFrontmatter(input);

    expect(result.name).toBe("my-skill");
    expect(result.description).toBe("A skill");
    expect(result.metadata).toEqual({
      category: "tool-based",
      runtime: [],
      runtimeDependency: ["axios"],
      runtimeEnvVar: ["API_KEY"],
      toolList: ["Bash", "Read"],
      tag: ["test"],
    });
    // Flat fields removed
    expect(result.tools).toBeUndefined();
    expect(result.runtimes).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.env).toBeUndefined();
    expect(result.dependencies).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  test("flatFrontmatter_withRuntimeDependencies_alternateKey", () => {
    const input = {
      name: "my-skill",
      category: "runtime_required",
      runtimeDependencies: ["lodash"],
    };
    const result = adaptOldFrontmatter(input);
    expect((result.metadata as any).runtimeDependency).toEqual(["lodash"]);
  });

  test("flatFrontmatter_withEnvVars_alternateKey", () => {
    const input = {
      name: "my-skill",
      category: "runtime_required",
      envVars: ["SECRET"],
    };
    const result = adaptOldFrontmatter(input);
    expect((result.metadata as any).runtimeEnvVar).toEqual(["SECRET"]);
  });

  test("flatFrontmatter_noCategory_defaultsToPlain", () => {
    const input = { name: "my-skill" };
    const result = adaptOldFrontmatter(input);
    expect((result.metadata as any).category).toBe("plain");
  });

  test("flatFrontmatter_missingArrays_defaultsToEmpty", () => {
    const input = { name: "my-skill", category: "plain" };
    const result = adaptOldFrontmatter(input);
    expect((result.metadata as any).runtime).toEqual([]);
    expect((result.metadata as any).runtimeDependency).toEqual([]);
    expect((result.metadata as any).runtimeEnvVar).toEqual([]);
    expect((result.metadata as any).toolList).toEqual([]);
    expect((result.metadata as any).tag).toEqual([]);
  });
});

// ============================================================================
// adaptApiRequest
// ============================================================================

describe("adaptApiRequest", () => {
  test("newShape_withMetadata_returnsAsIs", () => {
    const body = {
      name: "my-skill",
      description: "A skill",
      metadata: { category: "plain" },
    };
    const { adapted, isLegacy } = adaptApiRequest(body);
    expect(adapted).toEqual(body);
    expect(isLegacy).toBe(false);
  });

  test("oldShape_withFlatTools_transforms", () => {
    const body = {
      name: "my-skill",
      description: "A skill",
      category: "tools_required",
      tools: ["Bash"],
    };
    const { adapted, isLegacy } = adaptApiRequest(body);
    expect(isLegacy).toBe(true);
    expect((adapted.metadata as any).toolList).toEqual(["Bash"]);
  });

  test("oldShape_withFlatRuntimes_transforms", () => {
    const body = {
      name: "my-skill",
      description: "A skill",
      category: "runtime_required",
      runtimes: ["node"],
    };
    const { adapted, isLegacy } = adaptApiRequest(body);
    expect(isLegacy).toBe(true);
    expect((adapted.metadata as any).runtime).toEqual(["node"]);
  });

  test("noToolsOrRuntimes_noMetadata_notLegacy", () => {
    const body = { name: "my-skill", description: "A skill" };
    const { adapted, isLegacy } = adaptApiRequest(body);
    // No flat tools/runtimes and no metadata, not detected as legacy
    expect(isLegacy).toBe(false);
    expect(adapted).toEqual(body);
  });
});

// ============================================================================
// yamlKeysToCamel / camelKeysToYaml
// ============================================================================

describe("yamlKeysToCamel", () => {
  test("mapsHyphenatedKeysToCamelCase", () => {
    const input = {
      "disable-model-invocation": true,
      "user-invocable": false,
      "allowed-tools": ["Bash"],
      "argument-hint": "hint",
      name: "unchanged",
    };
    const result = yamlKeysToCamel(input);
    expect(result.disableModelInvocation).toBe(true);
    expect(result.userInvocable).toBe(false);
    expect(result.allowedTools).toEqual(["Bash"]);
    expect(result.argumentHint).toBe("hint");
    expect(result.name).toBe("unchanged");
  });

  test("mapsNestedMetadataKeys", () => {
    const input = {
      metadata: {
        category: "runtime-based",
        "runtime-dependency": ["axios"],
        "runtime-env-var": ["API_KEY"],
        "tool-list": ["Bash"],
      },
    };
    const result = yamlKeysToCamel(input);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.runtimeDependency).toEqual(["axios"]);
    expect(meta.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(meta.toolList).toEqual(["Bash"]);
    expect(meta.category).toBe("runtime-based");
  });

  test("nonMappedKeys_passThrough", () => {
    const input = { name: "test", description: "desc" };
    const result = yamlKeysToCamel(input);
    expect(result.name).toBe("test");
    expect(result.description).toBe("desc");
  });
});

describe("camelKeysToYaml", () => {
  test("mapsCamelCaseToHyphenated", () => {
    const input = {
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ["Bash"],
      argumentHint: "hint",
      name: "unchanged",
    };
    const result = camelKeysToYaml(input);
    expect(result["disable-model-invocation"]).toBe(true);
    expect(result["user-invocable"]).toBe(false);
    expect(result["allowed-tools"]).toEqual(["Bash"]);
    expect(result["argument-hint"]).toBe("hint");
    expect(result.name).toBe("unchanged");
  });

  test("mapsNestedMetadataKeys", () => {
    const input = {
      metadata: {
        category: "runtime-based",
        runtimeDependency: ["axios"],
        runtimeEnvVar: ["API_KEY"],
        toolList: ["Bash"],
      },
    };
    const result = camelKeysToYaml(input);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta["runtime-dependency"]).toEqual(["axios"]);
    expect(meta["runtime-env-var"]).toEqual(["API_KEY"]);
    expect(meta["tool-list"]).toEqual(["Bash"]);
  });
});
