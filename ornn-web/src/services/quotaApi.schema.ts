/**
 * Standalone Zod schema for `/me/quota` so unit tests can import the
 * schema without dragging in the apiClient → authStore → zustand persist
 * chain (which needs jsdom localStorage on import).
 *
 * `quotaApi.ts` re-exports the same schema for the runtime parser.
 *
 * @module services/quotaApi.schema
 */

import { z } from "zod";

export const SurfaceSnapshotSchema = z
  .object({
    defaultAllotment: z.number().int().nonnegative(),
    adminGrant: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int(),
    warningThreshold: z.number().nonnegative(),
    warning: z.boolean(),
  })
  .strict();

export type SurfaceSnapshot = z.infer<typeof SurfaceSnapshotSchema>;

export const QuotaSnapshotSchema = z
  .object({
    isAdmin: z.boolean(),
    monthMarker: z.string().regex(/^\d{4}-\d{2}$/),
    monthStart: z.string(),
    monthEnd: z.string(),
    nextMonthlyResetAt: z.string(),
    playground: SurfaceSnapshotSchema,
    skillGen: SurfaceSnapshotSchema,
  })
  .strict()
  .refine(
    (val) => {
      const looksLikeOldShape =
        "daily" in (val.playground as object) ||
        "daily" in (val.skillGen as object);
      return !looksLikeOldShape;
    },
    {
      message:
        "Quota payload still carries deprecated `daily` block — backend regression (RT-ME-QUOTA-SHAPE).",
    },
  );

export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>;
