/**
 * Per-user quota types for the playground and skill-generation surfaces.
 *
 * v1 ships flat-weighted (every call costs 1, regardless of model). Cost
 * weighting is a phase-2 follow-up tracked in #250. The shape leaves room
 * for that — counters are integers, deduction order is monthly-base then
 * credits, and a daily ceiling caps the combined pool.
 *
 * @module domains/quota/types
 */

/**
 * Surface identifier. Both surfaces have independent counters and credit
 * buckets — there is no shared budget. Adding a third surface means
 * extending this union and the per-user sub-document; the deduction
 * logic is generic over `Surface`.
 */
export type Surface = "playground" | "skillGen";

/**
 * Literal tuple form so Zod's `z.enum(...)` can pin the union exactly.
 * The `as const` keeps the literal types intact for `z.enum`.
 */
export const SURFACES = ["playground", "skillGen"] as const;

/**
 * Per-surface limits applied as a hard wall. Defaults below come from
 * #250's spec table.
 */
export interface SurfaceLimits {
  /** Monthly base allotment (resets on the 1st of each month UTC). */
  readonly monthlyBase: number;
  /** Daily ceiling on top of base + credits combined (resets at 00:00 UTC). */
  readonly dailyCeiling: number;
}

export interface QuotaLimits {
  readonly playground: SurfaceLimits;
  readonly skillGen: SurfaceLimits;
  /**
   * Threshold (0..1) at which the soft-warning UI banner appears.
   * Spec says 80% of monthly base; expressed as 0.8 here.
   */
  readonly warningThreshold: number;
}

export const DEFAULT_QUOTA_LIMITS: QuotaLimits = {
  playground: { monthlyBase: 200, dailyCeiling: 50 },
  skillGen: { monthlyBase: 20, dailyCeiling: 5 },
  warningThreshold: 0.8,
};

/**
 * Per-surface counter sub-document. Reset bookkeeping is done lazily on
 * read+charge against the live UTC marker — `monthlyResetMarker` /
 * `dailyResetMarker`. Any access compares the current marker to the
 * stored one and zeroes the counter when they differ. This keeps the
 * system robust against a missed cron run and avoids a global sweep at
 * midnight UTC for every user.
 */
export interface SurfaceCounter {
  /** Calls used in the current monthly window (base + credits combined). */
  monthlyUsed: number;
  /** Calls used in the current daily window. */
  dailyUsed: number;
  /**
   * Non-expiring admin-granted credit balance. Decremented after the
   * monthly base is exhausted. Granted credits never expire across
   * window rollovers — this is the source of truth for credit
   * lifetime.
   */
  creditsBalance: number;
  /** YYYY-MM in UTC, e.g. `"2026-05"`. Mismatch zeros `monthlyUsed`. */
  monthlyResetMarker: string;
  /** YYYY-MM-DD in UTC. Mismatch zeros `dailyUsed`. */
  dailyResetMarker: string;
}

/**
 * Whole-user quota sub-document. Created lazily on first quota read or
 * charge — absent users behave identically to fresh ones.
 */
export interface UserQuotaDocument {
  userId: string;
  playground: SurfaceCounter;
  skillGen: SurfaceCounter;
  updatedAt: Date;
}

/**
 * Reason a charge was attempted. Drives whether the call counts:
 *  - `success` and `skill_error` both charge (the run reached the skill).
 *  - `system_error` does not charge (LLM API timeout, infra 5xx, abort).
 */
export type ChargeOutcome = "success" | "skill_error" | "system_error";

/** Audit-trail entry for an admin grant. Bulk grants spawn N rows. */
export interface QuotaGrantAudit {
  _id: string;
  adminUserId: string;
  adminEmail: string;
  adminDisplayName: string;
  targetUserId: string;
  surface: Surface;
  amount: number;
  createdAt: Date;
  note?: string;
}

/**
 * Live "you can / cannot make a call" decision. `allowed=false` carries
 * enough info for the route to render the spec's 429 message.
 */
export type QuotaDecision =
  | { allowed: true; isAdminBypass: boolean }
  | {
      allowed: false;
      isAdminBypass: false;
      surface: Surface;
      scope: "monthly" | "daily";
      message: string;
    };

/** Snapshot returned by the `GET /me/quota` endpoint. */
export interface QuotaSnapshot {
  playground: SurfaceSnapshot;
  skillGen: SurfaceSnapshot;
  isAdmin: boolean;
}

export interface SurfaceSnapshot {
  monthly: { limit: number; used: number; remaining: number };
  daily: { limit: number; used: number; remaining: number };
  credits: { balance: number };
  warningThreshold: number;
  warning: boolean;
  monthlyResetAt: string;
  dailyResetAt: string;
}

export function currentMonthlyMarker(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function currentDailyMarker(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nextMonthlyResetAt(now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0));
}

export function nextDailyResetAt(now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  return new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
}

export function freshSurfaceCounter(now: Date = new Date()): SurfaceCounter {
  return {
    monthlyUsed: 0,
    dailyUsed: 0,
    creditsBalance: 0,
    monthlyResetMarker: currentMonthlyMarker(now),
    dailyResetMarker: currentDailyMarker(now),
  };
}

/**
 * Permission that exempts the caller from the counter and authorizes
 * grant operations. Reused across the quota and models domains.
 */
export const QUOTA_ADMIN_PERMISSION = "ornn:admin:skill" as const;
