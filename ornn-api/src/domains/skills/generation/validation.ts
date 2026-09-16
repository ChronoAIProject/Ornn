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
 * Array fields that must be empty in `simple` mode. `category` (must be
 * `plain`) and `outputType` (must be absent — the web frontmatter
 * builder emits `output-type` when set, and the frontmatter schema
 * rejects it on a plain skill, so a stray value would make the
 * generated SKILL.md unpublishable) are checked separately.
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
 * Names of the fields that make an answer unacceptable in `simple`
 * mode. Works on the raw parsed JSON object as well as on a validated
 * `GeneratedSkill`, so the check can run BEFORE schema validation — a
 * document that trips an unrelated schema rule (say, an over-long
 * description) but still carries `scripts` must be classified as a
 * mode violation, not a schema failure, or the multi-turn path would
 * deliver it verbatim. Empty array ⇒ legal simple package.
 */
export function findSimpleModeViolations(doc: object): string[] {
  const d = doc as Record<string, unknown>;
  const violations: string[] = [];
  if (d.category !== undefined && d.category !== "plain") violations.push("category");
  if (d.outputType !== undefined && d.outputType !== null) violations.push("outputType");
  for (const field of SIMPLE_MODE_EMPTY_FIELDS) {
    const value = d[field];
    if (Array.isArray(value) && value.length > 0) violations.push(field);
  }
  return violations;
}

/**
 * Strip markdown fences / surrounding prose and parse the JSON object.
 * Anything that is not a JSON object (unparseable text, `null`, an
 * array, a scalar) is `invalid_json`.
 */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (err) {
    // Generated-skill JSON parse failed. Caller treats this as
    // "regenerate" or "give up" depending on retry budget. Logging
    // so we can spot a model that's consistently producing
    // unparseable output (#579).
    logger.debug({ err }, "generated skill JSON parse failed");
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    logger.debug({ kind: Array.isArray(json) ? "array" : typeof json }, "generated skill JSON is not an object");
    return null;
  }
  return json as Record<string, unknown>;
}

const INVALID_JSON: GeneratedSkillValidation = {
  ok: false,
  reason: "invalid_json",
  message: "Invalid JSON from LLM",
  violations: [],
};

/** Schema-validate a parsed object, applying the legacy `readmeMd` migration first. */
function validateSchema(json: Record<string, unknown>): GeneratedSkillValidation {
  // Handle backward-compat: rename readmeMd -> readmeBody. Only a string
  // can be migrated; anything else is left for the schema to reject.
  if (typeof json.readmeMd === "string" && !json.readmeBody) {
    const md = json.readmeMd;
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
 * Parse + schema-validate. Returns `null` when the text is not a
 * schema-valid skill document.
 */
export function parseGeneratedSkill(raw: string): GeneratedSkill | null {
  const json = parseJsonObject(raw);
  if (!json) return null;
  const result = validateSchema(json);
  return result.ok ? result.skill : null;
}

/**
 * Parse, then apply the package-shape rule for `mode`, then
 * schema-validate. In `advanced` mode every schema-valid answer is
 * accepted; in `simple` mode any parseable answer that carries scripts /
 * references / assets / runtime fields, an `outputType`, or a non-plain
 * category is rejected as a `mode_violation` — before the schema runs,
 * so the classification does not depend on the rest of the document
 * being well-formed.
 */
export function validateGeneratedSkill(
  raw: string,
  mode: GenerationMode,
): GeneratedSkillValidation {
  const json = parseJsonObject(raw);
  if (!json) return INVALID_JSON;

  if (mode === "simple") {
    const violations = findSimpleModeViolations(json);
    if (violations.length > 0) {
      logger.debug({ violations }, "Generated skill violates simple mode");
      return {
        ok: false,
        reason: "mode_violation",
        message: `Simple mode allows SKILL.md only, but the model emitted: ${violations.join(", ")}`,
        violations,
      };
    }
  }

  return validateSchema(json);
}
