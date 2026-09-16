/**
 * Parsing + schema validation of the JSON document the LLM returns for
 * a generated skill, plus the per-mode package-shape check (#1242).
 *
 * Split out of `service.ts` so the schema has one home and the service
 * only orchestrates streaming. `validateGeneratedSkill` is the single
 * entry point; it tells the caller *why* an answer was rejected so the
 * retry prompt can address the actual problem.
 *
 * @module domains/skills/generation/validation
 */

import { z } from "zod";
import type { GeneratedSkill, GenerationMode } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("skillGenerationValidation");

/**
 * One emitted package file. Shared by `scripts`, `references` and
 * `assets` — the JSON contract can only carry text, so binary assets are
 * out of scope for generation (they still arrive via upload).
 */
const generatedFileSchema = z.object({
  filename: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
});

export const generatedSkillSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  description: z.string().min(10).max(500),
  category: z.enum(["plain", "runtime-based"]),
  outputType: z.enum(["text", "file"]).optional(),
  tags: z.array(z.string().min(2).max(30).regex(/^[a-z0-9-]+$/)).min(1).max(10),
  readmeBody: z.string().min(50).max(20_000),
  runtimes: z.array(z.string()).default([]),
  dependencies: z.array(z.string().max(200)).default([]),
  envVars: z.array(z.string().max(100)).default([]),
  scripts: z.array(generatedFileSchema).default([]),
  // Advanced-mode extras (#1242). Defaulted so older model output (and
  // the integration fixtures) that omit them still validate.
  references: z.array(generatedFileSchema).default([]),
  assets: z.array(generatedFileSchema).default([]),
});

/**
 * Why an answer was rejected. `mode_violation` is only ever produced in
 * `simple` mode and is the one case the multi-turn path retries.
 */
export type GeneratedSkillRejection = "invalid_json" | "schema" | "mode_violation";

export type GeneratedSkillValidation =
  | { ok: true; skill: GeneratedSkill }
  | {
      ok: false;
      reason: GeneratedSkillRejection;
      /** Human-readable summary, safe to send in a `validation_error` frame. */
      message: string;
      /** Offending field names — set for `mode_violation` only. */
      violations: string[];
    };

/**
 * Array fields that must be empty in `simple` mode. `category` is checked
 * separately (must be `plain`). `outputType` is deliberately not listed:
 * a stray `outputType` on a plain skill is harmless and the frontmatter
 * builder ignores it.
 */
const SIMPLE_MODE_EMPTY_FIELDS = [
  "scripts",
  "references",
  "assets",
  "runtimes",
  "dependencies",
  "envVars",
] as const;

/**
 * Names of the fields that make a schema-valid skill unacceptable in
 * `simple` mode. Empty array ⇒ the skill is a legal simple package.
 */
export function findSimpleModeViolations(skill: GeneratedSkill): string[] {
  const violations: string[] = [];
  if (skill.category !== "plain") violations.push("category");
  for (const field of SIMPLE_MODE_EMPTY_FIELDS) {
    if (skill[field].length > 0) violations.push(field);
  }
  return violations;
}

/**
 * Strip markdown fences / surrounding prose, parse the JSON object and
 * validate it against {@link generatedSkillSchema}. Returns `null` when
 * the text is not a schema-valid skill document.
 */
export function parseGeneratedSkill(raw: string): GeneratedSkill | null {
  const result = parseGeneratedSkillDetailed(raw);
  return result.ok ? result.skill : null;
}

function parseGeneratedSkillDetailed(raw: string): GeneratedSkillValidation {
  let json: Record<string, unknown>;
  try {
    let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    json = JSON.parse(cleaned);
  } catch (err) {
    // Generated-skill JSON parse failed. Caller treats this as
    // "regenerate" or "give up" depending on retry budget. Logging
    // so we can spot a model that's consistently producing
    // unparseable output (#579).
    logger.debug({ err }, "generated skill JSON parse failed");
    return { ok: false, reason: "invalid_json", message: "Invalid JSON from LLM", violations: [] };
  }

  // Handle backward-compat: rename readmeMd -> readmeBody
  if (json.readmeMd && !json.readmeBody) {
    const md = json.readmeMd as string;
    const fmEnd = md.indexOf("\n---", 3);
    json.readmeBody = fmEnd > 0 ? md.slice(fmEnd + 4).trim() : md;
    delete json.readmeMd;
  }

  const result = generatedSkillSchema.safeParse(json);
  if (!result.success) {
    logger.debug({ errors: result.error.issues }, "Generated skill validation failed");
    return { ok: false, reason: "schema", message: "Invalid JSON from LLM", violations: [] };
  }

  // The Zod-inferred shape and GeneratedSkill match in spirit but
  // Zod surfaces `outputType` as `"text" | "file" | undefined`
  // (explicit undefined, not optional) which exactOptionalPropertyTypes
  // (#657) treats as different from the interface's `outputType?:`.
  // Same runtime shape; cast is safe.
  return { ok: true, skill: result.data as GeneratedSkill };
}

/**
 * Parse + schema-validate, then apply the package-shape rule for `mode`.
 * In `advanced` mode every schema-valid answer is accepted; in `simple`
 * mode an answer that carries scripts / references / assets / runtime
 * fields or a non-plain category is rejected as a `mode_violation`.
 */
export function validateGeneratedSkill(
  raw: string,
  mode: GenerationMode,
): GeneratedSkillValidation {
  const parsed = parseGeneratedSkillDetailed(raw);
  if (!parsed.ok || mode !== "simple") return parsed;

  const violations = findSimpleModeViolations(parsed.skill);
  if (violations.length === 0) return parsed;

  logger.debug({ violations }, "Generated skill violates simple mode");
  return {
    ok: false,
    reason: "mode_violation",
    message: `Simple mode allows SKILL.md only, but the model emitted: ${violations.join(", ")}`,
    violations,
  };
}
