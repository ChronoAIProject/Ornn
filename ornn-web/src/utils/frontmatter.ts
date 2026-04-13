/**
 * Frontmatter Parser Utility.
 * Parses YAML frontmatter from skill markdown content using the `yaml` package.
 * @module utils/frontmatter
 */

import { parse as parseYaml } from "yaml";
import type { SkillFrontmatterOutput } from "./skillFrontmatterSchema";

/** Re-export the output type for external use */
export type { SkillFrontmatterOutput as SkillFrontmatter };

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---/;

/**
 * Map of hyphenated YAML keys to camelCase TypeScript keys.
 */
const YAML_TO_CAMEL: Record<string, string> = {
  "disable-model-invocation": "disableModelInvocation",
  "user-invocable": "userInvocable",
  "allowed-tools": "allowedTools",
  "argument-hint": "argumentHint",
  "runtime-dependency": "runtimeDependency",
  "runtime-env-var": "runtimeEnvVar",
  "tool-list": "toolList",
  "output-type": "outputType",
};

/**
 * Recursively convert hyphenated YAML keys to camelCase TypeScript keys.
 * Handles one level of nesting (the `metadata` sub-object).
 */
function yamlKeysToCamel(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const camelKey = YAML_TO_CAMEL[key] ?? key;

    if (
      camelKey === "metadata" &&
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[camelKey] = yamlKeysToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }

  return result;
}

/**
 * Extract and parse YAML frontmatter from markdown content.
 * Uses proper YAML parsing to support nested structures (e.g., `metadata` block).
 * Returns null if no valid frontmatter is found.
 */
export function extractFrontmatter(
  markdown: string,
): SkillFrontmatterOutput | null {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(FRONTMATTER_REGEX);
  if (!match) return null;

  try {
    const raw = parseYaml(match[1]);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

    const camelized = yamlKeysToCamel(raw as Record<string, unknown>);

    // Return camelized shape without strict validation (display-only).
    // Callers that need validation should use validateSkillFrontmatter() separately.
    return camelized as SkillFrontmatterOutput;
  } catch {
    return null;
  }
}

/**
 * Strip YAML frontmatter from markdown, returning only the body content.
 */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").replace(FRONTMATTER_REGEX, "").trim();
}
