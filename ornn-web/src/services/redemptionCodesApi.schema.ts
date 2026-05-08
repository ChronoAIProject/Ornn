/**
 * Standalone Zod schemas for redemption-code payloads. Mirrors the
 * backend types in `ornn-api/src/domains/redemption-codes/types.ts`
 * but with ISO string dates as the wire format.
 *
 * Kept separate from `redemptionCodesApi.ts` so unit tests can import
 * the schemas without dragging the apiClient → authStore → zustand
 * persist chain.
 *
 * @module services/redemptionCodesApi.schema
 */

import { z } from "zod";

export const SURFACE_VALUES = ["playground", "skillGen"] as const;
export const SurfaceSchema = z.enum(SURFACE_VALUES);
export type Surface = z.infer<typeof SurfaceSchema>;

export const REDEMPTION_CODE_STATUSES = [
  "active",
  "redeemed",
  "invalidated",
] as const;
export const RedemptionCodeStatusSchema = z.enum(REDEMPTION_CODE_STATUSES);
export type RedemptionCodeStatus = z.infer<typeof RedemptionCodeStatusSchema>;

export const RedemptionGrantEntrySchema = z
  .object({
    surface: SurfaceSchema,
    amount: z.number().int().positive(),
  })
  .strict();
export type RedemptionGrantEntry = z.infer<typeof RedemptionGrantEntrySchema>;

export const ActorMetaSchema = z
  .object({
    userId: z.string(),
    email: z.string(),
    displayName: z.string(),
  })
  .strict();
export type ActorMeta = z.infer<typeof ActorMetaSchema>;

/**
 * Wire shape emitted by the admin serializer in
 * `ornn-api/src/domains/admin/redemption-codes/routes.ts`. Optional
 * fields are emitted as `null` (not omitted) so the schema accepts
 * `null`.
 */
export const RedemptionCodeSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    grants: z.array(RedemptionGrantEntrySchema).min(1),
    note: z.string().nullable(),
    status: RedemptionCodeStatusSchema,
    createdAt: z.string(),
    createdBy: ActorMetaSchema,
    expiresAt: z.string(),
    redeemedAt: z.string().nullable(),
    redeemedBy: ActorMetaSchema.nullable(),
    invalidatedAt: z.string().nullable(),
    invalidatedBy: ActorMetaSchema.nullable(),
  })
  .strict();
export type RedemptionCode = z.infer<typeof RedemptionCodeSchema>;

export const MintCodeRequestSchema = z
  .object({
    grants: z.array(RedemptionGrantEntrySchema).min(1).max(SURFACE_VALUES.length),
    note: z.string().max(500).optional(),
    expiresAt: z.string(),
  })
  .strict();
export type MintCodeRequest = z.infer<typeof MintCodeRequestSchema>;

export const MintCodeResponseSchema = z
  .object({
    code: RedemptionCodeSchema,
  })
  .strict();
export type MintCodeResponse = z.infer<typeof MintCodeResponseSchema>;

export const RedemptionCodeListResponseSchema = z
  .object({
    items: z.array(RedemptionCodeSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().positive(),
  })
  .strict();
export type RedemptionCodeListResponse = z.infer<
  typeof RedemptionCodeListResponseSchema
>;

export const RedeemCodeRequestSchema = z
  .object({
    code: z.string().min(1),
  })
  .strict();
export type RedeemCodeRequest = z.infer<typeof RedeemCodeRequestSchema>;

export const RedeemAppliedGrantSchema = z
  .object({
    surface: SurfaceSchema,
    amount: z.number().int().nonnegative(),
    monthMarker: z.string(),
    newAdminGrant: z.number().int().nonnegative(),
  })
  .strict();
export type RedeemAppliedGrant = z.infer<typeof RedeemAppliedGrantSchema>;

export const RedeemCodeResponseSchema = z
  .object({
    codeId: z.string(),
    redeemedAt: z.string(),
    grants: z.array(RedeemAppliedGrantSchema).min(1),
  })
  .strict();
export type RedeemCodeResponse = z.infer<typeof RedeemCodeResponseSchema>;

export const RedemptionHistoryItemSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    grants: z.array(RedemptionGrantEntrySchema),
    note: z.string().nullable(),
    redeemedAt: z.string().nullable(),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .strict();
export type RedemptionHistoryItem = z.infer<typeof RedemptionHistoryItemSchema>;

export const RedemptionHistoryResponseSchema = z
  .object({
    items: z.array(RedemptionHistoryItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalPages: z.number().int().positive(),
  })
  .strict();
export type RedemptionHistoryResponse = z.infer<
  typeof RedemptionHistoryResponseSchema
>;
