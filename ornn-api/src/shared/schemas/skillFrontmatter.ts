/**
 * Canonical Zod schema for SKILL.md YAML frontmatter.
 * Updated with output-type field for runtime-based/mixed categories.
 * No backward compatibility adapter -- clean new format only.
 * @module shared/schemas/skillFrontmatter
 */

import { z } from "zod";

export const FRONTMATTER_CATEGORIES = ["plain", "tool-based", "runtime-based", "mixed"] as const;
export type FrontmatterCategory = (typeof FRONTMATTER_CATEGORIES)[number];

export const OUTPUT_TYPES = ["text", "file"] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

// Item-level schemas
const tagItemSchema = z.string().min(1).max(30).regex(/^[a-z0-9-]+$/, "Tags must be lowercase alphanumeric with hyphens");
const envVarItemSchema = z.string().min(1).max(100).regex(/^[A-Z_][A-Z0-9_]*$/, "Environment variable names must be UPPER_SNAKE_CASE");
const toolItemSchema = z.string().min(1).max(100);
const runtimeItemSchema = z.string().min(1).max(50);
const dependencyItemSchema = z.string().min(1).max(200);

// Metadata sub-schema (base, before refinement)
export const metadataSchema = z.object({
  category: z.enum(FRONTMATTER_CATEGORIES),
  "output-type": z.enum(OUTPUT_TYPES).optional(),
  runtime: z.array(runtimeItemSchema).default([]),
  "runtime-dependency": z.array(dependencyItemSchema).max(50).default([]),
  "runtime-env-var": z.array(envVarItemSchema).max(30).default([]),
  "tool-list": z.array(toolItemSchema).max(50).default([]),
  tag: z.array(tagItemSchema).max(10).default([]),
});

export type MetadataInput = z.input<typeof metadataSchema>;
export type MetadataOutput = z.output<typeof metadataSchema>;

// Conditional refinement per Architecture.md section 6.4
export const refinedMetadataSchema = metadataSchema.superRefine((data, ctx) => {
  const { category, runtime } = data;
  const toolList = data["tool-list"];
  const outputType = data["output-type"];

  // Category-based validation
  switch (category) {
    case "plain": {
      if (runtime.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime"], message: "runtime must not be provided when category is 'plain'" });
      }
      if (toolList.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tool-list"], message: "tool-list must not be provided when category is 'plain'" });
      }
      if (data["runtime-dependency"].length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime-dependency"], message: "runtime-dependency must not be provided when category is 'plain'" });
      }
      if (data["runtime-env-var"].length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime-env-var"], message: "runtime-env-var must not be provided when category is 'plain'" });
      }
      if (outputType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["output-type"], message: "output-type must not be provided when category is 'plain'" });
      }
      break;
    }
    case "tool-based": {
      if (runtime.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime"], message: "runtime must not be provided when category is 'tool-based'" });
      }
      if (toolList.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tool-list"], message: "tool-list is required when category is 'tool-based'" });
      }
      if (data["runtime-dependency"].length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime-dependency"], message: "runtime-dependency must not be provided when category is 'tool-based'" });
      }
      if (data["runtime-env-var"].length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime-env-var"], message: "runtime-env-var must not be provided when category is 'tool-based'" });
      }
      if (outputType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["output-type"], message: "output-type must not be provided when category is 'tool-based'" });
      }
      break;
    }
    case "runtime-based": {
      if (runtime.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime"], message: "runtime is required when category is 'runtime-based'" });
      }
      if (toolList.length > 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tool-list"], message: "tool-list must not be provided when category is 'runtime-based'" });
      }
      if (!outputType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["output-type"], message: "output-type is required when category is 'runtime-based'" });
      }
      break;
    }
    case "mixed": {
      if (runtime.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["runtime"], message: "runtime is required when category is 'mixed'" });
      }
      if (toolList.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tool-list"], message: "tool-list is required when category is 'mixed'" });
      }
      if (!outputType) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["output-type"], message: "output-type is required when category is 'mixed'" });
      }
      break;
    }
  }
});

/**
 * Skill version format: `<major>.<minor>` (2-digit, no patch).
 * Both parts must be non-negative integers. Leading zeroes are rejected.
 */
export const SKILL_VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Full frontmatter schema
export const skillFrontmatterSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, "Name must be kebab-case"),
  description: z.string().min(1).max(1024),
  // YAML parses `version: 0.1` (unquoted) as a float and `1.0` as an
  // integer `1`, which both lose the intended two-digit shape. We require
  // the author to quote it (`version: "0.1"`) so the round-trip is
  // lossless. A clear message points them at the fix.
  version: z
    .string({
      invalid_type_error:
        "version must be a quoted string — write `version: \"0.1\"` in SKILL.md, not `version: 0.1` (YAML parses the unquoted form as a number and loses the trailing zero).",
    })
    .regex(
      SKILL_VERSION_REGEX,
      "version must be in `<major>.<minor>` format, e.g. `1.0` (non-negative integers, no leading zeroes, no patch digit)",
    ),
  license: z.string().max(50).optional(),
  compatibility: z.string().max(500).optional(),
  metadata: refinedMetadataSchema,
  // Claude ecosystem fields (optional)
  "disable-model-invocation": z.boolean().default(false),
  "user-invocable": z.boolean().default(true),
  "allowed-tools": z.array(z.string()).optional(),
  model: z.string().max(100).optional(),
  context: z.array(z.string()).optional(),
  agent: z.string().max(100).optional(),
  "argument-hint": z.string().max(500).optional(),
  hooks: z.record(z.unknown()).optional(),
});

export type SkillFrontmatterInput = z.input<typeof skillFrontmatterSchema>;
export type SkillFrontmatterOutput = z.output<typeof skillFrontmatterSchema>;

export interface FrontmatterValidationError {
  field: string;
  message: string;
}

export function validateSkillFrontmatter(
  data: unknown,
):
  | { success: true; data: SkillFrontmatterOutput }
  | { success: false; errors: FrontmatterValidationError[] } {
  const result = skillFrontmatterSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: FrontmatterValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
  return { success: false, errors };
}
