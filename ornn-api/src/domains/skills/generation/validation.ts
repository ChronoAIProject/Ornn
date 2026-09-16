/**
 * Parsing + schema validation of the JSON document the LLM returns for
 * a generated skill. Split out of `service.ts` (#1242) so the schema has
 * one home and the service only orchestrates streaming.
 *
 * @module domains/skills/generation/validation
 */

import { z } from "zod";
import type { GeneratedSkill } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("skillGenerationValidation");

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
  scripts: z.array(z.object({
    filename: z.string().min(1).max(200),
    content: z.string().min(1).max(50_000),
  })).default([]),
});

/**
 * Strip markdown fences / surrounding prose, parse the JSON object and
 * validate it against {@link generatedSkillSchema}. Returns `null` when
 * the text is not a schema-valid skill document; callers decide whether
 * to retry or give up.
 */
export function parseGeneratedSkill(raw: string): GeneratedSkill | null {
  try {
    let cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const json = JSON.parse(cleaned);

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
      return null;
    }

    // The Zod-inferred shape and GeneratedSkill match in spirit but
    // Zod surfaces `outputType` as `"text" | "file" | undefined`
    // (explicit undefined, not optional) which exactOptionalPropertyTypes
    // (#657) treats as different from the interface's `outputType?:`.
    // Same runtime shape; cast is safe.
    return result.data as GeneratedSkill;
  } catch (err) {
    // Generated-skill JSON parse failed. Caller treats null as
    // "regenerate" or "give up" depending on retry budget. Logging
    // so we can spot a model that's consistently producing
    // unparseable output (#579).
    logger.debug({ err }, "generated skill JSON parse failed");
    return null;
  }
}
