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
}

export class QuotaService {
  private readonly repo: QuotaRepository;
  private readonly limits: QuotaLimits;
  private readonly adminPermission: string;

  constructor(config: QuotaServiceConfig) {
    this.repo = config.repo;
    this.limits = config.limits ?? DEFAULT_QUOTA_LIMITS;
    this.adminPermission = config.adminPermission ?? "ornn:admin:skill";
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
    return decide(counter, limits, params.surface);
  }

  /**
   * Charge a completed call. Deduction order:
   *   - If `monthlyUsed < monthlyBase`, charge the base bucket only.
   *   - Otherwise, decrement a credit (`creditsBalance`).
   *   - `monthlyUsed` is incremented in BOTH cases.
   *   - `outcome === "system_error"` is a no-op.
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
    const decrementCredit = baseExhausted && counter.creditsBalance > 0;

    await this.repo.charge({
      userId: params.userId,
      surface: params.surface,
      decrementCredit,
      now,
    });
    logger.debug(
      {
        userId: params.userId,
        surface: params.surface,
        outcome: params.outcome,
        decrementCredit,
      },
      "Quota charged",
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
    return {
      playground: this.buildSurfaceSnapshot(doc.playground, "playground", now),
      skillGen: this.buildSurfaceSnapshot(doc.skillGen, "skillGen", now),
      isAdmin,
    };
  }

  async grant(params: {
    admin: { userId: string; email: string; displayName: string };
    targetUserId: string;
    surface: Surface;
    amount: number;
    note?: string;
    now?: Date;
  }): Promise<{ auditId: string }> {
    const now = params.now ?? new Date();
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new Error(`Grant amount must be a positive integer (got ${params.amount})`);
    }
    await this.repo.addCredits({
      userId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      now,
    });
    const auditId = await this.repo.logGrant({
      adminUserId: params.admin.userId,
      adminEmail: params.admin.email,
      adminDisplayName: params.admin.displayName,
      targetUserId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      note: params.note,
      now,
    });
    logger.info(
      {
        adminUserId: params.admin.userId,
        targetUserId: params.targetUserId,
        surface: params.surface,
        amount: params.amount,
      },
      "Credits granted",
    );
    return { auditId };
  }

  async bulkGrant(params: {
    admin: { userId: string; email: string; displayName: string };
    targetUserIds: readonly string[];
    surface: Surface;
    amount: number;
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
  ): SurfaceSnapshot {
    const limits = this.surfaceLimits(surface);
    const baseRemaining = Math.max(0, limits.monthlyBase - counter.monthlyUsed);
    const totalMonthlyRemaining = Math.max(0, baseRemaining + counter.creditsBalance);
    const dailyRemaining = Math.max(0, limits.dailyCeiling - counter.dailyUsed);
    const warning = counter.monthlyUsed >= Math.floor(limits.monthlyBase * this.limits.warningThreshold);
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
      credits: { balance: counter.creditsBalance },
      warningThreshold: this.limits.warningThreshold,
      warning,
      monthlyResetAt: nextMonthlyResetAt(now).toISOString(),
      dailyResetAt: nextDailyResetAt(now).toISOString(),
    };
  }
}

/**
 * Pure decision function: given a counter and limits, can the caller
 * make another call? Exported separately so unit tests can exercise
 * the rules without spinning up a service or repository.
 */
export function decide(
  counter: SurfaceCounter,
  limits: SurfaceLimits,
  surface: Surface,
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
  const hasCapacity = baseRemaining > 0 || counter.creditsBalance > 0;
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
