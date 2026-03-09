/**
 * Tests for frontmatterAdapter.
 * Covers old-to-new mapping, category mapping, YAML key conversion.
 */

import { describe, it, expect } from "vitest";
import {
  adaptOldFrontmatter,
  mapOldCategory,
  yamlKeysToCamel,
  camelKeysToYaml,
} from "./frontmatterAdapter";

describe("mapOldCategory", () => {
  it("map_toolsRequired_returnsToolBased", () => {
    expect(mapOldCategory("tools_required")).toBe("tool-based");
  });

  it("map_runtimeRequired_returnsRuntimeBased", () => {
    expect(mapOldCategory("runtime_required")).toBe("runtime-based");
  });

  it("map_imported_returnsPlain", () => {
    expect(mapOldCategory("imported")).toBe("plain");
  });

  it("map_plain_returnsPlain", () => {
    expect(mapOldCategory("plain")).toBe("plain");
  });

  it("map_undefined_returnsPlain", () => {
    expect(mapOldCategory(undefined)).toBe("plain");
  });

  it("map_newValues_passThrough", () => {
    expect(mapOldCategory("tool-based")).toBe("tool-based");
    expect(mapOldCategory("runtime-based")).toBe("runtime-based");
    expect(mapOldCategory("mixed")).toBe("mixed");
  });
});

describe("adaptOldFrontmatter", () => {
  it("adapt_alreadyNested_passesThrough", () => {
    const input = {
      name: "test",
      metadata: { category: "plain" },
    };
    const result = adaptOldFrontmatter(input);
    expect(result).toEqual(input);
  });

  it("adapt_flatFrontmatter_mapsToNested", () => {
    const input = {
      name: "test",
      description: "desc",
      category: "tools_required",
      tools: ["Bash"],
      runtimes: [],
      tags: ["dev"],
      env: ["API_KEY"],
      dependencies: ["axios"],
    };

    const result = adaptOldFrontmatter(input);

    expect(result.name).toBe("test");
    expect(result.description).toBe("desc");
    expect(result.category).toBeUndefined();
    expect(result.tools).toBeUndefined();
    expect(result.runtimes).toBeUndefined();
    expect(result.tags).toBeUndefined();
    expect(result.env).toBeUndefined();
    expect(result.dependencies).toBeUndefined();

    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.category).toBe("tool-based");
    expect(metadata.toolList).toEqual(["Bash"]);
    expect(metadata.runtime).toEqual([]);
    expect(metadata.tag).toEqual(["dev"]);
    expect(metadata.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(metadata.runtimeDependency).toEqual(["axios"]);
  });

  it("adapt_flatWithRuntimeNpmDependencies_mapsCorrectly", () => {
    const input = {
      name: "test",
      category: "runtime_required",
      runtimes: ["node"],
      runtime_npm_dependencies: ["lodash"],
    };

    const result = adaptOldFrontmatter(input);
    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.runtimeDependency).toEqual(["lodash"]);
  });

  it("adapt_flatWithMissingFields_defaultsToEmptyArrays", () => {
    const input = { name: "test" };
    const result = adaptOldFrontmatter(input);

    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.category).toBe("plain");
    expect(metadata.runtime).toEqual([]);
    expect(metadata.toolList).toEqual([]);
    expect(metadata.tag).toEqual([]);
    expect(metadata.runtimeEnvVar).toEqual([]);
    expect(metadata.runtimeDependency).toEqual([]);
  });

  it("adapt_nonArrayValues_coercedToEmptyArrays", () => {
    const input = {
      name: "test",
      runtimes: "node",
      tools: 42,
      tags: true,
      env: { key: "val" },
      dependencies: null,
    };

    const result = adaptOldFrontmatter(input);
    const metadata = result.metadata as Record<string, unknown>;

    expect(metadata.runtime).toEqual([]);
    expect(metadata.toolList).toEqual([]);
    expect(metadata.tag).toEqual([]);
    expect(metadata.runtimeEnvVar).toEqual([]);
    expect(metadata.runtimeDependency).toEqual([]);
  });

  it("adapt_arraysWithNonStringEntries_filtersToStringsOnly", () => {
    const input = {
      name: "test",
      runtimes: ["node", 123, null, true, "python"],
      tools: ["Bash", undefined, { name: "Bash" }, "Read"],
      tags: [42, false],
    };

    const result = adaptOldFrontmatter(input);
    const metadata = result.metadata as Record<string, unknown>;

    expect(metadata.runtime).toEqual(["node", "python"]);
    expect(metadata.toolList).toEqual(["Bash", "Read"]);
    expect(metadata.tag).toEqual([]);
  });
});

describe("yamlKeysToCamel", () => {
  it("convert_topLevelKeys_toCamelCase", () => {
    const input = {
      "disable-model-invocation": true,
      "user-invocable": false,
      "allowed-tools": ["Bash"],
      "argument-hint": "a file path",
      name: "test",
    };

    const result = yamlKeysToCamel(input);

    expect(result.disableModelInvocation).toBe(true);
    expect(result.userInvocable).toBe(false);
    expect(result.allowedTools).toEqual(["Bash"]);
    expect(result.argumentHint).toBe("a file path");
    expect(result.name).toBe("test");
  });

  it("convert_metadataSubKeys_toCamelCase", () => {
    const input = {
      metadata: {
        category: "runtime-based",
        "runtime-dependency": ["axios"],
        "runtime-env-var": ["API_KEY"],
        "tool-list": ["Bash"],
      },
    };

    const result = yamlKeysToCamel(input);
    const metadata = result.metadata as Record<string, unknown>;

    expect(metadata.runtimeDependency).toEqual(["axios"]);
    expect(metadata.runtimeEnvVar).toEqual(["API_KEY"]);
    expect(metadata.toolList).toEqual(["Bash"]);
    expect(metadata.category).toBe("runtime-based");
  });

  it("convert_unknownKeys_passThrough", () => {
    const input = { unknownKey: "value" };
    const result = yamlKeysToCamel(input);
    expect(result.unknownKey).toBe("value");
  });
});

describe("camelKeysToYaml", () => {
  it("convert_camelKeys_toHyphenated", () => {
    const input = {
      disableModelInvocation: true,
      userInvocable: false,
      allowedTools: ["Bash"],
      argumentHint: "hint",
    };

    const result = camelKeysToYaml(input);

    expect(result["disable-model-invocation"]).toBe(true);
    expect(result["user-invocable"]).toBe(false);
    expect(result["allowed-tools"]).toEqual(["Bash"]);
    expect(result["argument-hint"]).toBe("hint");
  });

  it("convert_metadataSubKeys_toHyphenated", () => {
    const input = {
      metadata: {
        runtimeDependency: ["axios"],
        runtimeEnvVar: ["API_KEY"],
        toolList: ["Bash"],
        category: "mixed",
      },
    };

    const result = camelKeysToYaml(input);
    const metadata = result.metadata as Record<string, unknown>;

    expect(metadata["runtime-dependency"]).toEqual(["axios"]);
    expect(metadata["runtime-env-var"]).toEqual(["API_KEY"]);
    expect(metadata["tool-list"]).toEqual(["Bash"]);
    expect(metadata.category).toBe("mixed");
  });

  it("roundTrip_yamlToCamelAndBack_preserves", () => {
    const original = {
      name: "test",
      "disable-model-invocation": true,
      metadata: {
        category: "mixed",
        "runtime-dependency": ["axios"],
      },
    };

    const camel = yamlKeysToCamel(original);
    const restored = camelKeysToYaml(camel);

    expect(restored).toEqual(original);
  });
});
