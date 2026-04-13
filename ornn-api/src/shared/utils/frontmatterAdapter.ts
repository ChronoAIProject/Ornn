/**
 * Backward compatibility adapter for old flat frontmatter shapes.
 *
 * Provides utilities to:
 * - Detect and map old flat frontmatter to the new nested metadata structure
 * - Convert old category values (underscore) to new values (hyphenated)
 * - Bidirectional YAML key mapping (hyphenated <-> camelCase)
 * - Detect old API request body shapes and transform them
 *
 * @module shared/utils/frontmatterAdapter
 */

// ============================================================================
// Category Mapping
// ============================================================================

const OLD_TO_NEW_CATEGORY: Record<string, string> = {
  tools_required: "tool-based",
  runtime_required: "runtime-based",
  imported: "plain",
};

/**
 * Convert old category values to the new hyphenated format.
 * Passes through already-valid values unchanged.
 */
export function mapOldCategory(value: string | undefined): string {
  if (!value) return "plain";
  return OLD_TO_NEW_CATEGORY[value] ?? value;
}

// ============================================================================
// Old-to-New Frontmatter Mapping
// ============================================================================

/**
 * Detects old flat frontmatter shape (no `metadata` block) and maps it
 * to the new nested structure. Used on the read path (loading old skills)
 * and on the API ingestion path (old request bodies).
 *
 * If a `metadata` block already exists, the input is returned as-is.
 */
export function adaptOldFrontmatter(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (raw.metadata && typeof raw.metadata === "object") {
    return raw;
  }

  const adapted = { ...raw };

  adapted.metadata = {
    category: mapOldCategory(raw.category as string | undefined),
    runtime: asArray(raw.runtimes),
    runtimeDependency: asArray(raw.dependencies ?? raw.runtimeDependencies),
    runtimeEnvVar: asArray(raw.env ?? raw.envVars),
    toolList: asArray(raw.tools),
    tag: asArray(raw.tags),
  };

  // Remove old flat fields that are now in metadata
  delete adapted.tools;
  delete adapted.runtimes;
  delete adapted.dependencies;
  delete adapted.runtimeDependencies;
  delete adapted.env;
  delete adapted.envVars;
  delete adapted.tags;
  delete adapted.category;

  return adapted;
}

// ============================================================================
// API Request Adapter
// ============================================================================

/**
 * Detects old API request body shape (flat tools/runtimes without metadata)
 * and transforms it. Returns { adapted, isLegacy }.
 */
export function adaptApiRequest(body: Record<string, unknown>): {
  adapted: Record<string, unknown>;
  isLegacy: boolean;
} {
  const hasMetadata = body.metadata && typeof body.metadata === "object";
  const hasFlatTools =
    Array.isArray(body.tools) || Array.isArray(body.runtimes);

  if (hasMetadata || !hasFlatTools) {
    return { adapted: body, isLegacy: false };
  }

  return { adapted: adaptOldFrontmatter(body), isLegacy: true };
}

// ============================================================================
// YAML <-> CamelCase Key Mapping
// ============================================================================

/** Map of hyphenated YAML keys to camelCase TypeScript property names. */
const YAML_TO_CAMEL: Record<string, string> = {
  "disable-model-invocation": "disableModelInvocation",
  "user-invocable": "userInvocable",
  "allowed-tools": "allowedTools",
  "argument-hint": "argumentHint",
  "runtime-dependency": "runtimeDependency",
  "runtime-env-var": "runtimeEnvVar",
  "tool-list": "toolList",
};

/** Reverse map: camelCase to hyphenated YAML keys. */
const CAMEL_TO_YAML: Record<string, string> = Object.fromEntries(
  Object.entries(YAML_TO_CAMEL).map(([k, v]) => [v, k]),
);

/**
 * Convert hyphenated YAML keys to camelCase.
 * Recursively handles the `metadata` sub-object.
 */
export function yamlKeysToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = YAML_TO_CAMEL[key] ?? key;

    if (key === "metadata" && value && typeof value === "object" && !Array.isArray(value)) {
      result[camelKey] = yamlKeysToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }

  return result;
}

/**
 * Convert camelCase keys to hyphenated YAML keys.
 * Recursively handles the `metadata` sub-object.
 */
export function camelKeysToYaml(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const yamlKey = CAMEL_TO_YAML[key] ?? key;

    if (key === "metadata" && value && typeof value === "object" && !Array.isArray(value)) {
      result[yamlKey] = camelKeysToYaml(value as Record<string, unknown>);
    } else {
      result[yamlKey] = value;
    }
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

/** Safely coerce a value to a string array, defaulting to []. */
function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}
