/**
 * Frontmatter Builder Utility.
 * Builds YAML frontmatter strings from skill metadata for SKILL.md generation.
 * Emits the new nested `metadata` structure with hyphenated YAML keys.
 * @module utils/frontmatterBuilder
 */

import type { SkillMetadata } from "@/types/skillPackage";

/**
 * Pattern matching YAML values that must be quoted.
 * Matches values starting with YAML indicator characters, containing
 * mapping/comment ambiguity patterns, or resembling YAML keywords.
 */
const YAML_NEEDS_QUOTING =
  /^[{[\]>|*&!%@`'",?#~\- :]/;
const YAML_KEYWORD =
  /^(true|false|yes|no|on|off|null|~)$/i;

/**
 * Format a YAML scalar value. Only wraps in double quotes when the value
 * contains characters that require quoting per YAML spec.
 * Matches the official Claude skill documentation style (unquoted where safe).
 */
function formatYamlValue(value: string): string {
  if (
    !value ||
    YAML_NEEDS_QUOTING.test(value) ||
    YAML_KEYWORD.test(value) ||
    value.includes(": ") ||
    value.includes(" #") ||
    value.includes("\n")
  ) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

/**
 * Emit a YAML array field, indented by the given depth.
 * Only emits the field if the array is non-empty.
 */
function emitArrayField(
  lines: string[],
  key: string,
  values: string[],
  indent: number,
): void {
  if (values.length === 0) return;
  const prefix = " ".repeat(indent);
  lines.push(`${prefix}${key}:`);
  values.forEach((v) => lines.push(`${prefix}  - ${formatYamlValue(v)}`));
}

/**
 * Builds a YAML frontmatter string from skill metadata.
 * Outputs the new nested `metadata` structure with hyphenated YAML keys.
 * Only includes optional fields if they have values.
 * Uses unquoted YAML values where safe (matching official Claude skill style).
 */
export function buildFrontmatter(meta: SkillMetadata): string {
  const lines: string[] = ["---"];

  // Core fields
  lines.push(`name: ${formatYamlValue(meta.name)}`);
  lines.push(`description: ${formatYamlValue(meta.description)}`);
  // version is required by the backend. Quoted unconditionally — without
  // quotes, YAML parses "0.1" as a float and the backend's string schema
  // rejects it with "Expected string, received number".
  lines.push(`version: "${(meta.version || "0.1").replace(/"/g, '\\"')}"`);

  // Official Claude fields (only if non-default)
  if (meta.disableModelInvocation) {
    lines.push("disable-model-invocation: true");
  }
  if (meta.userInvocable === false) {
    lines.push("user-invocable: false");
  }
  emitArrayField(lines, "allowed-tools", meta.allowedTools, 0);
  if (meta.model) {
    lines.push(`model: ${formatYamlValue(meta.model)}`);
  }
  emitArrayField(lines, "context", meta.context, 0);
  if (meta.agent) {
    lines.push(`agent: ${formatYamlValue(meta.agent)}`);
  }
  if (meta.argumentHint) {
    lines.push(`argument-hint: ${formatYamlValue(meta.argumentHint)}`);
  }
  if (meta.hooks && Object.keys(meta.hooks).length > 0) {
    lines.push(`hooks: ${JSON.stringify(meta.hooks)}`);
  }

  // Ornn extensions
  if (meta.license) {
    lines.push(`license: ${formatYamlValue(meta.license)}`);
  }
  if (meta.compatibility) {
    lines.push(`compatibility: ${formatYamlValue(meta.compatibility)}`);
  }

  // Nested metadata block
  lines.push("metadata:");
  lines.push(`  category: ${formatYamlValue(meta.metadata.category)}`);
  if (meta.metadata.outputType) {
    lines.push(`  output-type: ${formatYamlValue(meta.metadata.outputType)}`);
  }
  emitArrayField(lines, "runtime", meta.metadata.runtime, 2);
  emitArrayField(lines, "tool-list", meta.metadata.toolList, 2);
  emitArrayField(lines, "runtime-dependency", meta.metadata.runtimeDependency, 2);
  emitArrayField(lines, "runtime-env-var", meta.metadata.runtimeEnvVar, 2);
  emitArrayField(lines, "tag", meta.metadata.tag, 2);

  lines.push("---");
  return lines.join("\n");
}

/**
 * Combines frontmatter and body markdown into a complete SKILL.md string.
 */
export function buildSkillMd(
  meta: SkillMetadata,
  bodyMarkdown: string,
): string {
  const frontmatter = buildFrontmatter(meta);
  return `${frontmatter}\n\n${bodyMarkdown}`;
}
