/**
 * Skill Creation Form Schemas.
 * Zod schemas and derived types for the guided skill creation wizard.
 * Uses the canonical frontmatter schema's refined metadata sub-schema
 * for consistent conditional validation.
 * @module utils/skillCreateSchemas
 */

import { z } from "zod";
import { refinedMetadataSchema } from "./skillFrontmatterSchema";

/**
 * Step 1 schema: basic metadata with nested metadata, optional Claude fields,
 * and conditional tool/runtime requirements enforced by refinedMetadataSchema.
 */
export const basicInfoSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(64, "Name must be at most 64 characters")
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Must start with a letter or number, only lowercase, numbers, and hyphens",
    ),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(500),

  /** Nested metadata with conditional validation */
  metadata: refinedMetadataSchema,

  /** SPDX license identifier */
  license: z.string().max(50).optional(),

  /** Compatibility information */
  compatibility: z.string().max(200).optional(),

  // --- Advanced Claude fields (collapsed by default) ---

  disableModelInvocation: z.boolean().default(false),
  userInvocable: z.boolean().default(true),
  allowedTools: z.array(z.string()).default([]),
  model: z.string().max(100).optional(),
  context: z.array(z.string()).default([]),
  agent: z.string().max(100).optional(),
  argumentHint: z.string().max(500).optional(),
  hooks: z.record(z.unknown()).optional(),
});

/**
 * Step 2 schema: markdown body content for SKILL.md.
 */
export const contentSchema = z.object({
  readmeMd: z.string().min(50, "Content must be at least 50 characters"),
});

export type BasicInfoData = z.infer<typeof basicInfoSchema>;
export type ContentData = z.infer<typeof contentSchema>;
