/**
 * Skill Frontmatter Zod Schema.
 *
 * Canonical Zod schema for the SKILL.md YAML frontmatter.
 * Covers official Claude skill spec fields (top-level) and
 * Ornn platform extensions (nested under `metadata`).
 *
 * Validation error messages are JSON-encoded `{ key, params? }`
 * payloads so the consuming layer can translate them via
 * `translateError` / `t(key, params)` at render time.
 *
 * @module utils/skillFrontmatterSchema
 */

import { z } from "zod";
import { encodeErrorPayload, type ErrorPayload } from "@/utils/translateError";

function issueMessage(payload: ErrorPayload): string {
  return encodeErrorPayload(payload);
}

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
    issueMessage({ key: "errors.frontmatter.tagFormat" }),
  );

const envVarItemSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[A-Z_][A-Z0-9_]*$/,
    issueMessage({ key: "errors.frontmatter.envVarFormat" }),
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
        message: issueMessage({
          key: "errors.frontmatter.runtimeRequiredForCategory",
          params: { category },
        }),
      });
    }
    if (forbidsRuntime && runtime.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime"],
        message: issueMessage({
          key: "errors.frontmatter.runtimeForbiddenForCategory",
          params: { category },
        }),
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
        message: issueMessage({
          key: "errors.frontmatter.toolListRequiredForCategory",
          params: { category },
        }),
      });
    }
    if (forbidsTools && toolList.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolList"],
        message: issueMessage({
          key: "errors.frontmatter.toolListForbiddenForCategory",
          params: { category },
        }),
      });
    }

    // output-type: required for runtime-based/mixed, forbidden for plain/tool-based
    if (needsRuntime && !data.outputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputType"],
        message: issueMessage({
          key: "errors.frontmatter.outputTypeRequiredForCategory",
          params: { category },
        }),
      });
    }
    if (forbidsRuntime && data.outputType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputType"],
        message: issueMessage({
          key: "errors.frontmatter.outputTypeForbiddenForCategory",
          params: { category },
        }),
      });
    }

    // runtimeDependency and runtimeEnvVar forbidden for plain/tool-based
    if (forbidsRuntime) {
      if (data.runtimeDependency.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeDependency"],
          message: issueMessage({
            key: "errors.frontmatter.runtimeDependencyForbiddenForCategory",
            params: { category },
          }),
        });
      }
      if (data.runtimeEnvVar.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runtimeEnvVar"],
          message: issueMessage({
            key: "errors.frontmatter.runtimeEnvVarForbiddenForCategory",
            params: { category },
          }),
        });
      }
    }
  },
);

// --- Full frontmatter schema ---

/**
 * Skill version format: `<major>.<minor>` (2-digit, no patch).
 * Both parts must be non-negative integers. Leading zeroes are rejected.
 */
export const SKILL_VERSION_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const skillFrontmatterSchema = z.object({
  // Official Claude skill fields (top-level)
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      issueMessage({ key: "errors.frontmatter.nameFormat" }),
    ),
  description: z.string().min(1).max(1024),
  version: z
    .string()
    .regex(
      SKILL_VERSION_REGEX,
      issueMessage({ key: "errors.frontmatter.versionFormat" }),
    ),
  disableModelInvocation: z.boolean().default(false),
  userInvocable: z.boolean().default(true),
  allowedTools: z.array(z.string()).optional(),
  model: z.string().max(100).optional(),
  context: z.array(z.string()).optional(),
  agent: z.string().max(100).optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
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

/**
 * Structured frontmatter validation error. `messageKey` is an i18n key
 * the consumer translates via `t(messageKey, params)`. When the
 * underlying Zod issue did not carry an explicit JSON payload (built-in
 * Zod message such as "Required" / "String must contain at least 1
 * character(s)"), the falsy-key case is signalled by `messageKey ===
 * "errors.frontmatter.generic"` and the raw Zod string is supplied via
 * `params.detail` for display.
 */
export interface FrontmatterValidationError {
  field: string;
  messageKey: string;
  // exactOptionalPropertyTypes (#657)
  params?: Record<string, string | number> | undefined;
  received?: unknown;
}

function parseIssueMessage(raw: string): {
  key: string;
  params?: Record<string, string | number>;
} {
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.key === "string") {
        return { key: parsed.key, params: parsed.params };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    key: "errors.frontmatter.generic",
    params: { detail: raw },
  };
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
    (issue) => {
      const parsed = parseIssueMessage(issue.message);
      return {
        field: issue.path.join("."),
        messageKey: parsed.key,
        params: parsed.params,
      };
    },
  );
  return { success: false, errors };
}
