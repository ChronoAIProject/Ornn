/**
 * Skill Creation Form Schemas.
 * Zod schemas and derived types for the guided skill creation wizard.
 * Uses the canonical frontmatter schema's refined metadata sub-schema
 * for consistent conditional validation.
 *
 * Validation messages render through `t()` so they follow the active
 * UI language (#695). Each consumer passes a translator into the
 * `make…Schema(t)` factory and memoizes the resulting schema against
 * the current `t` reference so a language switch rebuilds the form
 * resolver without rerendering everything.
 *
 * Static schemas (`basicInfoSchema`, `contentSchema`) remain exported
 * with literal English fallbacks for type-derivation and any non-UI
 * caller (tests, server-side reuse). The factories are the canonical
 * UI entrypoint.
 *
 * @module utils/skillCreateSchemas
 */

import { z } from "zod";
import { refinedMetadataSchema } from "./skillFrontmatterSchema";

/** i18next-shaped translator. Loose signature so the real
 *  `TFunction` from react-i18next (variadic options, overloaded
 *  return types) assigns cleanly without a hard runtime dependency. */
type Translator = (key: string, ...rest: unknown[]) => string;

const EN_MESSAGES = {
  nameMin: "Name must be at least 2 characters",
  nameMax: "Name must be at most 64 characters",
  nameShape: "Must start with a letter or number, only lowercase, numbers, and hyphens",
  descMin: "Description must be at least 10 characters",
  contentMin: "Content must be at least 50 characters",
} as const;

function msg(t: Translator | undefined, key: keyof typeof EN_MESSAGES): string {
  const en = EN_MESSAGES[key];
  return t ? t(`guided.validation.${key}`, en) : en;
}

/**
 * Step 1 schema factory: basic metadata with nested metadata, optional
 * Claude fields, and conditional tool/runtime requirements enforced by
 * refinedMetadataSchema. Pass `t` from `useTranslation()`; omit for
 * the English-fallback static shape.
 */
export function makeBasicInfoSchema(t?: Translator) {
  return z.object({
    name: z
      .string()
      .min(2, msg(t, "nameMin"))
      .max(64, msg(t, "nameMax"))
      .regex(/^[a-z0-9][a-z0-9-]*$/, msg(t, "nameShape")),
    description: z
      .string()
      .min(10, msg(t, "descMin"))
      .max(500),

    metadata: refinedMetadataSchema,
    license: z.string().max(50).optional(),
    compatibility: z.string().max(200).optional(),

    disableModelInvocation: z.boolean().default(false),
    userInvocable: z.boolean().default(true),
    allowedTools: z.array(z.string()).default([]),
    model: z.string().max(100).optional(),
    context: z.array(z.string()).default([]),
    agent: z.string().max(100).optional(),
    argumentHint: z.string().max(500).optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
  });
}

/**
 * Step 2 schema factory: markdown body content for SKILL.md.
 */
export function makeContentSchema(t?: Translator) {
  return z.object({
    readmeMd: z.string().min(50, msg(t, "contentMin")),
  });
}

/** Static English-fallback schemas — preserve the original export
 *  surface for callers that don't have a `t` in scope (tests, type
 *  derivation, server-side reuse). */
export const basicInfoSchema = makeBasicInfoSchema();
export const contentSchema = makeContentSchema();

// `Input` is the pre-validation shape (fields with `.default(...)` are
// optional); `Data` is the post-validation shape (defaults applied, so
// those fields are required). @hookform/resolvers 5 typed the Resolver
// against the output, so consumers of these forms need both variants
// (input for `useForm` / `UseFormReturn`, output for the submit handler).
export type BasicInfoInput = z.input<typeof basicInfoSchema>;
export type BasicInfoData = z.output<typeof basicInfoSchema>;
export type ContentInput = z.input<typeof contentSchema>;
export type ContentData = z.output<typeof contentSchema>;
