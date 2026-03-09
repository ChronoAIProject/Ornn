/**
 * Skill Frontmatter Zod Schema (Frontend Mirror).
 * Mirror of packages/ornn-shared/src/schemas/skillFrontmatterSchema.ts -- keep in sync.
 *
 * Canonical Zod schema for the SKILL.md YAML frontmatter.
 * Covers official Claude skill spec fields (top-level) and
 * Ornn platform extensions (nested under `metadata`).
 *
 * @module utils/skillFrontmatterSchema
 */

import { z } from "zod";

/** Canonical category values (hyphenated, per Claude spec). */
export const FRONTMATTER_CATEGORIES = [
  "plain",
  "tool-based",
  "runtime-based",
  "mixed",
] as const;

export type FrontmatterCategory = (typeof FRONTMATTER_CATEGORIES)[number];

/** Allowed output-type values for runtime-based/mixed categories. */
export const OUTPUT_TYPES = ["text", "file"] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

/** Allowed runtime identifiers (extensible). */
export const ALLOWED_RUNTIMES = ["node", "python"] as const;

// --- Sub-item schemas ---

const tagItemSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(
    /^[a-z0-9-]+$/,
    "Tags must be lowercase alphanumeric with hyphens",
  );

const envVarItemSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[A-Z_][A-Z0-9_]*$/,
    "Environment variable names must be UPPER_SNAKE_CASE",
  );

const toolItemSchema = z.string().min(1).max(100);
const runtimeItemSchema = z.string().min(1).max(50);
const dependencyItemSchema = z.string().min(1).max(200);

// --- Metadata sub-schema (without conditional refinement) ---

export const metadataSchema = z.object({
  category: z.enum(FRONTMATTER_CATEGORIES),
  outputType: z.enum(OUTPUT_TYPES).optional(),
  runtime: z.array(runtimeItemSchema).default([]),
  runtimeDependency: z.array(dependencyItemSchema).max(50).default([]),
  runtimeEnvVar: z.array(envVarItemSchema).max(30).default([]),
  toolList: z.array(toolItemSchema).max(50).default([]),
  tag: z.array(tagItemSchema).max(10).default([]),
});

// --- Conditional refinement ---

export const refinedMetadataSchema = metadataSchema.superRefine(
  (data, ctx) => {
    const { category, runtime, toolList } = data;

    const needsRuntime =
      category === "runtime-based" || category === "mixed";
    const forbidsRuntime =
      category === "plain" || category === "tool-based";

    if (needsRuntime && runtime.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime"],
        message: `runtime is required when category is '${category}'`,
      });
    }
    if (forbidsRuntime && runtime.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime"],
        message: `runtime must not be provided when category is '${category}'`,
      });
    }

    const needsTools =
      category === "tool-based" || category === "mixed";
    const forbidsTools =
      category === "plain" || category === "runtime-based";

    if (needsTools && toolList.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolList"],
        message: `tool-list is required when category is '${category}'`,
      });
    }
    if (forbidsTools && toolList.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolList"],
        message: `tool-list must not be provided when category is '${category}'`,
      });
    }

    // output-type: required for runtime-based/mixed, forbidden for plain/tool-based
    if (needsRuntime && !data.outputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputType"],
        message: `output-type is required when category is '${category}'`,
      });
    }
    if (forbidsRuntime && data.outputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputType"],
        message: `output-type must not be provided when category is '${category}'`,
      });
    }

    // runtimeDependency and runtimeEnvVar forbidden for plain/tool-based
    if (forbidsRuntime) {
      if (data.runtimeDependency.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeDependency"],
          message: `runtime-dependency must not be provided when category is '${category}'`,
        });
      }
      if (data.runtimeEnvVar.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeEnvVar"],
          message: `runtime-env-var must not be provided when category is '${category}'`,
        });
      }
    }
  },
);

// --- Full frontmatter schema ---

export const skillFrontmatterSchema = z.object({
  // Official Claude skill fields (top-level)
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Name must start with a letter or number and contain only lowercase letters, numbers, and hyphens",
    ),
  description: z.string().min(1).max(1024),
  disableModelInvocation: z.boolean().default(false),
  userInvocable: z.boolean().default(true),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().max(100).optional(),
  context: z.array(z.string()).optional(),
  agent: z.string().max(100).optional(),
  hooks: z.record(z.unknown()).optional(),
  argumentHint: z.string().max(500).optional(),

  // Ornn platform extensions (top-level)
  license: z.string().max(50).optional(),
  compatibility: z.string().max(200).optional(),

  // Nested metadata
  metadata: refinedMetadataSchema,
});

export type SkillFrontmatterInput = z.input<typeof skillFrontmatterSchema>;
export type SkillFrontmatterOutput = z.output<typeof skillFrontmatterSchema>;
export type MetadataInput = z.input<typeof metadataSchema>;
export type MetadataOutput = z.output<typeof metadataSchema>;

// --- Validation helper ---

export interface FrontmatterValidationError {
  field: string;
  message: string;
  received?: unknown;
}

/**
 * Validate frontmatter data against the canonical schema.
 * Returns either validated data or an array of structured errors.
 */
export function validateSkillFrontmatter(
  data: unknown,
):
  | { success: true; data: SkillFrontmatterOutput }
  | { success: false; errors: FrontmatterValidationError[] } {
  const result = skillFrontmatterSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: FrontmatterValidationError[] = result.error.issues.map(
    (issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }),
  );
  return { success: false, errors };
}
