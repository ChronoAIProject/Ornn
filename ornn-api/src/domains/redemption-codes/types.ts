/**
 * Admin-issued redemption codes — types + Zod schemas.
 *
 * A redemption code is a single-use, server-minted token that an admin
 * hands to a user. Redeeming it applies one or more quota grants to the
 * caller's current-month bucket(s). Each code is consumable exactly
 * once across all users (atomic active → redeemed transition); admins
 * can also retire an unused code via active → invalidated.
 *
 * Codes are stored canonical-uppercase. Lookup is case-insensitive: the
 * boundary Zod schema upper-cases incoming user input so the unique
 * index does the right thing without needing collation.
 *
 * @module domains/redemption-codes/types
 */

import { z } from "zod";
import { SURFACES, type Surface } from "../quota/types";

/**
 * Length of the random portion of a redemption code. 16 chars over a
 * 31-symbol alphabet ≈ 79 bits of entropy — comfortable for a single-
 * use token even before the unique index catches collisions.
 */
export const REDEMPTION_CODE_LENGTH = 16;

/**
 * Base32-ish alphabet, ambiguous glyphs removed: `0/O/1/I/L`. Length
 * 31. Picked so an admin can read a code over a phone call without
 * misreads, and a user typing it from a screenshot can't confuse a
 * zero for a capital O.
 */
export const REDEMPTION_CODE_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type RedemptionCodeStatus = "active" | "redeemed" | "invalidated";

/**
 * One slot in the multi-surface grant bundle a code carries. A code may
 * carry up to one entry per surface; the service refuses duplicates so
 * the redeem path can apply each grant independently.
 */
export interface RedemptionGrantEntry {
  surface: Surface;
  amount: number;
}

/**
 * Snapshot of the actor at the moment they touched a code. Persisted
 * verbatim so audit views don't need a second NyxID round-trip per row.
 */
export interface ActorMeta {
  userId: string;
  email: string;
  displayName: string;
}

// Optional fields widen to `| undefined` so callers passing Zod-
// inferred shapes or building docs incrementally fit under
// exactOptionalPropertyTypes (#657).
export interface RedemptionCodeDoc {
  /** ObjectId hex string. */
  _id: string;
  /** Canonical uppercase code, unique. */
  code: string;
  grants: RedemptionGrantEntry[];
  note?: string | undefined;
  createdAt: Date;
  createdBy: ActorMeta;
  expiresAt: Date;
  status: RedemptionCodeStatus;
  redeemedAt?: Date | undefined;
  redeemedBy?: ActorMeta | undefined;
  invalidatedAt?: Date | undefined;
  invalidatedBy?: ActorMeta | undefined;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const grantEntrySchema = z.object({
  surface: z.enum(SURFACES),
  amount: z.number().int().positive().max(100_000),
});

export const mintCodeSchema = z.object({
  grants: z
    .array(grantEntrySchema)
    .min(1)
    .max(SURFACES.length)
    .refine(
      (entries) => new Set(entries.map((e) => e.surface)).size === entries.length,
      "Duplicate surface in grants",
    ),
  note: z.string().max(500).optional(),
  expiresAt: z
    .string()
    .datetime()
    .refine(
      (d) => new Date(d) > new Date(),
      "expiresAt must be in the future",
    ),
});

/**
 * Body schema for `POST /me/redemption-codes/redeem`. Trims + uppercases
 * at the boundary so the service compares against the canonical form
 * stored on the doc.
 */
export const redeemSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .transform((s) => s.trim().toUpperCase()),
});

export const REDEMPTION_CODE_STATUSES = [
  "active",
  "redeemed",
  "invalidated",
] as const;

/**
 * Query-string schema for `GET /admin/redemption-codes`. `z.coerce` on
 * pagination because query params arrive as strings.
 */
export const listFilterSchema = z.object({
  status: z.enum(REDEMPTION_CODE_STATUSES).optional(),
  q: z.string().max(64).optional(),
  page: z.coerce.number().int().positive().max(10_000).optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

export type MintCodeInput = z.infer<typeof mintCodeSchema>;
export type RedeemInput = z.infer<typeof redeemSchema>;
export type ListFilterInput = z.infer<typeof listFilterSchema>;
