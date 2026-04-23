import { parse as parseYaml } from "yaml";
import {
  validateSkillFrontmatter,
  type SkillFrontmatterOutput,
  type FrontmatterValidationError,
} from "../schemas/skillFrontmatter";
import { adaptOldFrontmatter, yamlKeysToCamel } from "./frontmatterAdapter";

const FRONTMATTER_REGEX = /^\s*---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Result of frontmatter validation against the canonical Zod schema.
 */
export interface FrontmatterValidationResult {
  valid: boolean;
  errors: FrontmatterValidationError[];
  data?: SkillFrontmatterOutput;
}

/**
 * Extracts and parses YAML frontmatter from a markdown string.
 * Handles both new nested format and old flat format via the adapter.
 * Returns null if no valid frontmatter block is found.
 */
export function extractFrontmatter(
  markdown: string,
): Record<string, unknown> | null {
  const match = markdown.match(FRONTMATTER_REGEX);
  if (!match) return null;

  try {
    const parsed = parseYaml(match[1]);
    if (typeof parsed !== "object" || parsed === null) return null;

    const raw = parsed as Record<string, unknown>;
    const camelized = yamlKeysToCamel(raw);
    return adaptOldFrontmatter(camelized);
  } catch {
    return null;
  }
}

/**
 * Validates frontmatter data against the canonical Zod schema.
 * Accepts either new nested or old flat format (auto-adapted).
 * Returns structured validation errors on failure.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
): FrontmatterValidationResult {
  const camelized = yamlKeysToCamel(frontmatter);
  const adapted = adaptOldFrontmatter(camelized);
  const result = validateSkillFrontmatter(adapted);

  if (result.success) {
    return { valid: true, errors: [], data: result.data };
  }
  return { valid: false, errors: result.errors };
}

// Re-export types for consumers
export type { SkillFrontmatterOutput, FrontmatterValidationError };
