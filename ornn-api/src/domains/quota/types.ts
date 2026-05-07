/**
 * Per-user quota types — calendar-month bucket model.
 *
 * Each user has two independent buckets keyed by (`userId`, `surface`,
 * `monthMarker`). A bucket = `defaultAllotment + adminGrant − used`, all
 * non-negative integers. Buckets reset by being abandoned: at the UTC
 * month rollover the next request lands on a new (`userId`, `surface`,
 * `<new monthMarker>`) doc. No carry-over, no daily ceiling, no
 * per-grant expiry.
 *
 * @module domains/quota/types
 */

export type Surface = "playground" | "skillGen";

export const SURFACES = ["playground", "skillGen"] as const;

export const QUOTA_ADMIN_PERMISSION = "ornn:admin:skill" as const;

/**
 * Reason a charge was attempted. Drives whether the call counts:
 *  - `success` and `skill_error` both charge (the run reached the skill).
 *  - `system_error` does not charge (LLM API timeout, infra 5xx, abort).
 */
export type ChargeOutcome = "success" | "skill_error" | "system_error";

/**
 * Per-user-per-month-per-surface bucket. _id derived from
 * `${userId}:${surface}:${monthMarker}` so the upsert in
 * `chargeOnCompletion` can collide safely.
 */
export interface QuotaBucketDoc {
  _id: string;
  userId: string;
  surface: Surface;
  monthMarker: string;
  monthStart: Date;
  monthEnd: Date;
  /**
   * Snapshot of the platform default at first-touch. Never updated
   * after $setOnInsert. Runtime computes
   *   `effectiveDefault = max(stored, currentSettingsDefault)`
   * so raising the default mid-month grants headroom; lowering does
   * not retroactively shrink.
   */
  defaultAllotment: number;
  adminGrant: number;
  used: number;
  usedByModel: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaGrantAuditDoc {
  _id: string;
  adminUserId: string;
  adminEmail: string;
  adminDisplayName: string;
  targetUserId: string;
  surface: Surface;
  amount: number;
  note?: string;
  monthMarker: string;
  createdAt: Date;
}

export type QuotaDecision =
  | { allowed: true; isAdminBypass: boolean }
  | {
      allowed: false;
      isAdminBypass: false;
      surface: Surface;
      message: string;
    };

export interface SurfaceSnapshot {
  defaultAllotment: number;
  adminGrant: number;
  used: number;
  remaining: number;
  warningThreshold: number;
  warning: boolean;
}

export interface QuotaSnapshot {
  isAdmin: boolean;
  monthMarker: string;
  monthStart: string;
  monthEnd: string;
  nextMonthlyResetAt: string;
  playground: SurfaceSnapshot;
  skillGen: SurfaceSnapshot;
}

/**
 * Default soft-warning threshold (used / (default + adminGrant)) at
 * which the UI surfaces a warning chip. Settings-routable in a future
 * pass; keeps the same semantic as the old model for now.
 */
export const DEFAULT_WARNING_THRESHOLD = 0.8;

export function currentMonthMarker(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function nextMonthlyResetAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export interface MonthBounds {
  monthMarker: string;
  monthStart: Date;
  monthEnd: Date;
}

export function monthBounds(now: Date = new Date()): MonthBounds {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return {
    monthMarker: `${y}-${String(m + 1).padStart(2, "0")}`,
    monthStart: new Date(Date.UTC(y, m, 1)),
    monthEnd: new Date(Date.UTC(y, m + 1, 1)),
  };
}

export function bucketId(userId: string, surface: Surface, monthMarker: string): string {
  return `${userId}:${surface}:${monthMarker}`;
}

/**
 * Mongo path keys can't contain `.` or `$`. Model ids generally won't,
 * but better fail-safe than 500 the request: substitute disallowed
 * chars with `_`. Empty / nullish → `__unknown__` sentinel.
 */
export function escapeModelKey(modelId: string | null | undefined): string {
  if (!modelId) return "__unknown__";
  return modelId.replace(/[.$]/g, "_");
}
