/**
 * Zod schemas for the broadcasts domain (#500). Used by both the
 * admin routes (POST/PATCH validation) and the OpenAPI builder.
 *
 * **Bilingual contract.** Title and body are nested `{ en, zh }`
 * objects. On create both locales are required and non-empty. On
 * patch, each locale is optional, but a provided locale string must
 * be non-empty (so an admin can't accidentally blank one side via a
 * stray empty string in the payload — they must omit the field).
 *
 * @module domains/broadcasts/schemas
 */

import { z } from "zod";

/** Max title length per locale. Same cap as announcements (`titleEn`). */
const TITLE_MAX = 200;
/** Max body markdown length per locale. Same cap as announcements. */
const BODY_MAX = 20_000;

const nonEmptyTrimmed = (max: number) => z.string().trim().min(1).max(max);

/**
 * Create-time i18n pair: both locales required + non-empty.
 *
 * Trims whitespace so a payload like `{ en: "  Hi  ", zh: "你好" }`
 * stores `"Hi"`. Rejects `{ en: "", zh: "..." }`.
 */
export const broadcastI18nCreateSchema = (max: number) =>
  z
    .object({
      en: nonEmptyTrimmed(max),
      zh: nonEmptyTrimmed(max),
    })
    .strict();

/**
 * Patch-time i18n pair: each locale optional. When provided, must be
 * non-empty (after trim). Omit the field to leave that locale
 * unchanged. Cannot blank a locale via empty string — by design, both
 * locales remain required at rest.
 */
export const broadcastI18nPatchSchema = (max: number) =>
  z
    .object({
      en: nonEmptyTrimmed(max).optional(),
      zh: nonEmptyTrimmed(max).optional(),
    })
    .strict();

export const createBroadcastSchema = z
  .object({
    titleI18n: broadcastI18nCreateSchema(TITLE_MAX),
    bodyMarkdownI18n: broadcastI18nCreateSchema(BODY_MAX),
  })
  .strict();

export const patchBroadcastSchema = z
  .object({
    titleI18n: broadcastI18nPatchSchema(TITLE_MAX).optional(),
    bodyMarkdownI18n: broadcastI18nPatchSchema(BODY_MAX).optional(),
  })
  .strict()
  .refine(
    (val) => val.titleI18n !== undefined || val.bodyMarkdownI18n !== undefined,
    { message: "patch must include at least one of titleI18n or bodyMarkdownI18n" },
  )
  .refine(
    (val) => {
      // An object like `titleI18n: {}` is shaped legal but semantically
      // empty — reject so the route never persists a no-op locale patch.
      const hasTitleField =
        val.titleI18n === undefined ||
        val.titleI18n.en !== undefined ||
        val.titleI18n.zh !== undefined;
      const hasBodyField =
        val.bodyMarkdownI18n === undefined ||
        val.bodyMarkdownI18n.en !== undefined ||
        val.bodyMarkdownI18n.zh !== undefined;
      return hasTitleField && hasBodyField;
    },
    { message: "i18n patch object must include at least one locale" },
  );

export const adminBroadcastResponseSchema = z.object({
  id: z.string(),
  titleI18n: z.object({ en: z.string(), zh: z.string() }),
  bodyMarkdownI18n: z.object({ en: z.string(), zh: z.string() }),
  createdBy: z.string(),
  updatedBy: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  readCount: z.number().int().nonnegative(),
});

export const adminBroadcastListResponseSchema = z.object({
  data: z.object({
    items: z.array(adminBroadcastResponseSchema),
  }),
  error: z.null(),
});

export type CreateBroadcastInput = z.infer<typeof createBroadcastSchema>;
export type PatchBroadcastInput = z.infer<typeof patchBroadcastSchema>;
