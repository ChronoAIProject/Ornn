/**
 * Quota policy. Owns the deduction-order rule, the over-limit decision,
 * and the snapshot shape used by `/me/quota` and the soft-warning UI.
 *
 * Repository handles persistence; this layer enforces the rules:
 *  - Admins (any role with the configured permission) bypass the counter
 *    entirely. They never charge, never warn, never 429.
 *  - Charge order: monthly base depletes first; admin-granted credits are
 *    deducted last. Daily ceiling caps the combined pool.
 *  - System errors (LLM API timeout, infra 5xx) do NOT charge. Skill
 *    errors (the script ran but threw) DO charge — the run reached the
 *    skill counts.
 *
 * @module domains/quota/service
 */

import pino from "pino";
import type { QuotaRepository } from "./repository";
import type { NotificationService } from "../notifications/service";
import {
  DEFAULT_QUOTA_LIMITS,
  type ChargeOutcome,
  type QuotaDecision,
  type QuotaLimits,
  type QuotaSnapshot,
  type Surface,
  type SurfaceCounter,
  type SurfaceLimits,
  type SurfaceSnapshot,
  type UserQuotaDocument,
  nextDailyResetAt,
  nextMonthlyResetAt,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "quotaService" });

export interface QuotaServiceConfig {
  readonly repo: QuotaRepository;
  readonly limits?: QuotaLimits;
  readonly adminPermission?: string;
  /**
   * Optional. When provided, every successful single-user `grant` (and
   * by extension `bulkGrant` rows) emits a `quota.credits_granted`
   * notification to the recipient. Failure to enqueue is logged and
   * swallowed — notifications must never block the grant path.
   */
  readonly notificationService?: NotificationService;
}

export class QuotaService {
  private readonly repo: QuotaRepository;
  private readonly limits: QuotaLimits;
  private readonly adminPermission: string;
  private readonly notificationService?: NotificationService;

  constructor(config: QuotaServiceConfig) {
    this.repo = config.repo;
    this.limits = config.limits ?? DEFAULT_QUOTA_LIMITS;
    this.adminPermission = config.adminPermission ?? "ornn:admin:skill";
    this.notificationService = config.notificationService;
  }

  isAdmin(permissions: readonly string[] | undefined): boolean {
    return !!permissions?.includes(this.adminPermission);
  }

  surfaceLimits(surface: Surface): SurfaceLimits {
    return this.limits[surface];
  }

  /**
   * Decide whether a caller can make a call against `surface`. Reads
   * (and lazily resets) the user document; does NOT charge — caller
   * invokes `chargeOnCompletion` after the call actually completes.
   */
  async checkAllowed(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: Surface;
    now?: Date;
  }): Promise<QuotaDecision> {
    if (this.isAdmin(params.permissions)) {
      return { allowed: true, isAdminBypass: true };
    }
    const now = params.now ?? new Date();
    const doc = await this.repo.getOrInit(params.userId, now);
    const counter = doc[params.surface];
    const limits = this.surfaceLimits(params.surface);
    const activeCredits = await this.repo.sumActiveCredits(params.userId, params.surface, now);
    const totalCredits = (counter.creditsBalance ?? 0) + activeCredits;
    return decide(counter, limits, params.surface, totalCredits);
  }

  /**
   * Charge a completed call. Deduction order:
   *   1. If `monthlyUsed < monthlyBase`, charge the base only — no credit
   *      touch.
   *   2. Else try the legacy `creditsBalance` (non-expiring bucket from
   *      pre-ledger grants).
   *   3. Else try the oldest active grant in the ledger (FIFO).
   *
   *   - `monthlyUsed` and `dailyUsed` are incremented in EVERY case
   *     (admin sees a complete picture of usage even past the cap).
   *   - `outcome === "system_error"` is a no-op.
   *   - If no credits are available past the base, charge still happens
   *     (the `checkAllowed` guard should have prevented the call).
   */
  async chargeOnCompletion(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: Surface;
    outcome: ChargeOutcome;
    now?: Date;
  }): Promise<void> {
    if (this.isAdmin(params.permissions)) return;
    if (params.outcome === "system_error") return;

    const now = params.now ?? new Date();
    const doc = await this.repo.getOrInit(params.userId, now);
    const counter = doc[params.surface];
    const limits = this.surfaceLimits(params.surface);
    const baseExhausted = counter.monthlyUsed >= limits.monthlyBase;

    // Always increment monthly+daily counters — the user made a charged
    // call regardless of which bucket pays.
    await this.repo.chargeMonthly({
      userId: params.userId,
      surface: params.surface,
      now,
    });

    if (!baseExhausted) {
      logger.debug(
        { userId: params.userId, surface: params.surface, source: "monthly_base" },
        "Quota charged",
      );
      return;
    }

    // Past the base — drain credits. Try legacy bucket first (cheap
    // single-row update), then fall through to the active-grants ledger.
    if (
      await this.repo.tryDecrementLegacyCredits({
        userId: params.userId,
        surface: params.surface,
        now,
      })
    ) {
      logger.debug(
        { userId: params.userId, surface: params.surface, source: "legacy_credits" },
        "Quota charged",
      );
      return;
    }

    if (
      await this.repo.tryConsumeActiveGrant({
        userId: params.userId,
        surface: params.surface,
        now,
      })
    ) {
      logger.debug(
        { userId: params.userId, surface: params.surface, source: "active_grant" },
        "Quota charged",
      );
      return;
    }

    logger.warn(
      { userId: params.userId, surface: params.surface },
      "Charge happened past base but no credits available — checkAllowed guard should have caught this",
    );
  }

  /**
   * Build the user-facing snapshot for `/me/quota`. Admins see a
   * snapshot too (`isAdmin: true` so the UI can hide/replace the chip).
   */
  async getSnapshot(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    now?: Date;
  }): Promise<QuotaSnapshot> {
    const now = params.now ?? new Date();
    const isAdmin = this.isAdmin(params.permissions);
    const doc = await this.repo.getOrInit(params.userId, now);
    const [playgroundActive, skillGenActive] = await Promise.all([
      this.repo.sumActiveCredits(params.userId, "playground", now),
      this.repo.sumActiveCredits(params.userId, "skillGen", now),
    ]);
    return {
      playground: this.buildSurfaceSnapshot(doc.playground, "playground", now, playgroundActive),
      skillGen: this.buildSurfaceSnapshot(doc.skillGen, "skillGen", now, skillGenActive),
      isAdmin,
    };
  }

  /**
   * Compute the effective credits balance for a user/surface =
   * legacy non-expiring `creditsBalance` + sum of unused capacity
   * across all active grants in the ledger.
   */
  async getCreditsBalance(
    userId: string,
    surface: Surface,
    now: Date = new Date(),
  ): Promise<number> {
    const doc = await this.repo.getOrInit(userId, now);
    const legacy = doc[surface].creditsBalance ?? 0;
    const active = await this.repo.sumActiveCredits(userId, surface, now);
    return legacy + active;
  }

  async grant(params: {
    admin: { userId: string; email: string; displayName: string };
    targetUserId: string;
    surface: Surface;
    amount: number;
    /**
     * How many UTC months the grant stays active before the unused
     * remainder drops out of the user's balance. `null` or `undefined`
     * = never expires (legacy behavior). Must be a positive integer
     * when set.
     */
    periodMonths?: number | null;
    note?: string;
    now?: Date;
  }): Promise<{ auditId: string; expiresAt: Date | null }> {
    const now = params.now ?? new Date();
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new Error(`Grant amount must be a positive integer (got ${params.amount})`);
    }
    let expiresAt: Date | null = null;
    if (params.periodMonths !== undefined && params.periodMonths !== null) {
      if (!Number.isInteger(params.periodMonths) || params.periodMonths <= 0) {
        throw new Error(
          `Grant period must be a positive integer number of months (got ${params.periodMonths})`,
        );
      }
      expiresAt = addUtcMonths(now, params.periodMonths);
    }

    // Grant is **additive**: every call inserts a fresh ledger row, so
    // repeat grants stack on top of existing credits and the audit row
    // is the new credits' single source of truth (with `consumed` and
    // `expiresAt` tracked per-grant).
    const auditId = await this.repo.recordGrant({
      adminUserId: params.admin.userId,
      adminEmail: params.admin.email,
      adminDisplayName: params.admin.displayName,
      targetUserId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      expiresAt,
      note: params.note,
      now,
    });

    logger.info(
      {
        adminUserId: params.admin.userId,
        targetUserId: params.targetUserId,
        surface: params.surface,
        amount: params.amount,
        expiresAt,
      },
      "Credits granted (additive ledger row)",
    );
    // Fire-and-forget recipient notification. Failure to persist a
    // notification must NEVER fail the grant — caller has already seen
    // the credits land in their balance.
    if (this.notificationService) {
      this.notificationService
        .notifyQuotaCreditsGranted({
          targetUserId: params.targetUserId,
          surface: params.surface,
          amount: params.amount,
          note: params.note,
          adminDisplayName: params.admin.displayName,
        })
        .catch((err: unknown) => {
          logger.warn(
            { err, targetUserId: params.targetUserId },
            "Failed to enqueue credits-granted notification",
          );
        });
    }
    return { auditId, expiresAt };
  }

  async bulkGrant(params: {
    admin: { userId: string; email: string; displayName: string };
    targetUserIds: readonly string[];
    surface: Surface;
    amount: number;
    periodMonths?: number | null;
    note?: string;
    now?: Date;
  }): Promise<Array<{ userId: string; ok: boolean; auditId?: string; error?: string }>> {
    const now = params.now ?? new Date();
    const out: Array<{ userId: string; ok: boolean; auditId?: string; error?: string }> = [];
    for (const userId of params.targetUserIds) {
      try {
        const { auditId } = await this.grant({
          admin: params.admin,
          targetUserId: userId,
          surface: params.surface,
          amount: params.amount,
          periodMonths: params.periodMonths,
          note: params.note,
          now,
        });
        out.push({ userId, ok: true, auditId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ targetUserId: userId, err: message }, "Bulk grant row failed");
        out.push({ userId, ok: false, error: message });
      }
    }
    return out;
  }

  async getUserQuota(userId: string, now: Date = new Date()): Promise<UserQuotaDocument> {
    return this.repo.getOrInit(userId, now);
  }

  async listGrants(params: {
    page: number;
    pageSize: number;
    targetUserId?: string;
    adminUserId?: string;
  }) {
    return this.repo.listGrants(params);
  }

  private buildSurfaceSnapshot(
    counter: SurfaceCounter,
    surface: Surface,
    now: Date,
    activeCredits: number,
  ): SurfaceSnapshot {
    const limits = this.surfaceLimits(surface);
    const baseRemaining = Math.max(0, limits.monthlyBase - counter.monthlyUsed);
    // Credits = legacy non-expiring bucket + active grants (each with
    // its own remaining capacity + expiry tracked in the ledger).
    const totalCredits = (counter.creditsBalance ?? 0) + activeCredits;
    const totalMonthlyRemaining = Math.max(0, baseRemaining + totalCredits);
    const dailyRemaining = Math.max(0, limits.dailyCeiling - counter.dailyUsed);
    const warning =
      counter.monthlyUsed >= Math.floor(limits.monthlyBase * this.limits.warningThreshold);
    return {
      monthly: {
        limit: limits.monthlyBase,
        used: counter.monthlyUsed,
        remaining: totalMonthlyRemaining,
      },
      daily: {
        limit: limits.dailyCeiling,
        used: counter.dailyUsed,
        remaining: dailyRemaining,
      },
      credits: { balance: totalCredits },
      warningThreshold: this.limits.warningThreshold,
      warning,
      monthlyResetAt: nextMonthlyResetAt(now).toISOString(),
      dailyResetAt: nextDailyResetAt(now).toISOString(),
    };
  }
}

/**
 * Add `n` UTC months to `from`. Clamps day-of-month so e.g. Jan 31 +
 * 1 month → Feb 28/29 instead of overflowing into March.
 */
function addUtcMonths(from: Date, n: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + n;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  // Days-in-target-month — use UTC day 0 of the next month to get last day.
  const daysInTarget = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), daysInTarget);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/**
 * Pure decision function: given a counter, limits, and total credits
 * available (legacy + ledger), can the caller make another call?
 *
 * Exported separately so unit tests can exercise the rules without
 * spinning up a service or repository.
 */
export function decide(
  counter: SurfaceCounter,
  limits: SurfaceLimits,
  surface: Surface,
  totalCredits: number = counter.creditsBalance ?? 0,
): QuotaDecision {
  // Daily ceiling is a hard wall above the combined pool.
  if (counter.dailyUsed >= limits.dailyCeiling) {
    return {
      allowed: false,
      isAdminBypass: false,
      surface,
      scope: "daily",
      message: buildOverLimitMessage(surface, "daily"),
    };
  }
  const baseRemaining = limits.monthlyBase - counter.monthlyUsed;
  const hasCapacity = baseRemaining > 0 || totalCredits > 0;
  if (!hasCapacity) {
    return {
      allowed: false,
      isAdminBypass: false,
      surface,
      scope: "monthly",
      message: buildOverLimitMessage(surface, "monthly"),
    };
  }
  return { allowed: true, isAdminBypass: false };
}

function buildOverLimitMessage(
  surface: Surface,
  scope: "monthly" | "daily",
): string {
  const surfaceLabel = surface === "playground" ? "playground" : "skill-generation";
  const window = scope === "monthly" ? "monthly" : "daily";
  return `You've hit your ${window} ${surfaceLabel} limit — contact admin for credits, or upgrade when paid plans launch.`;
}
