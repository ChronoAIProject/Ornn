/**
 * Quota policy on the calendar-month bucket model.
 *
 *   - Admins (`ornn:admin:skill`) bypass entirely.
 *   - `checkAllowed` reads the current-month bucket. Pure read; no upsert.
 *   - `chargeOnCompletion` upserts the bucket and atomically increments
 *     `used` and `usedByModel.<id>`. `system_error` outcomes are no-ops.
 *   - `grant` adds to `adminGrant` for the current month and appends an
 *     audit row. Negative grants rejected (out of scope for v1).
 *   - Default allotment is settings-driven; runtime computes
 *     `effectiveDefault = max(stored, currentSettingsDefault)` so raising
 *     the default mid-month grants headroom; lowering doesn't retroact.
 *
 * @module domains/quota/service
 */

import { createLogger } from "../../shared/logger";
import type { NotificationService } from "../notifications/service";
import type { QuotaRepository } from "./repository";
import {
  DEFAULT_WARNING_THRESHOLD,
  type ChargeOutcome,
  type QuotaBucketDoc,
  type QuotaDecision,
  type QuotaSnapshot,
  type Surface,
  type SurfaceSnapshot,
  monthBounds,
  nextMonthlyResetAt,
} from "./types";

const logger = createLogger("quotaService");

export interface QuotaDefaults {
  defaultPlaygroundMonthly: number;
  defaultSkillGenMonthly: number;
}

export interface QuotaDefaultsResolver {
  getQuotaDefaults(): Promise<QuotaDefaults>;
}

export interface QuotaServiceConfig {
  repo: QuotaRepository;
  defaults: QuotaDefaultsResolver;
  adminPermission?: string;
  /** Optional notification fanout — failure is logged and swallowed. */
  notificationService?: NotificationService;
  warningThreshold?: number;
}

export class QuotaService {
  private readonly repo: QuotaRepository;
  private readonly defaults: QuotaDefaultsResolver;
  private readonly adminPermission: string;
  // exactOptionalPropertyTypes (#657): widen to `T | undefined`.
  private readonly notificationService: NotificationService | undefined;
  private readonly warningThreshold: number;

  constructor(config: QuotaServiceConfig) {
    this.repo = config.repo;
    this.defaults = config.defaults;
    this.adminPermission = config.adminPermission ?? "ornn:admin:skill";
    this.notificationService = config.notificationService;
    this.warningThreshold = config.warningThreshold ?? DEFAULT_WARNING_THRESHOLD;
  }

  isAdmin(permissions: readonly string[] | undefined): boolean {
    return !!permissions?.includes(this.adminPermission);
  }

  private async resolveDefault(surface: Surface): Promise<number> {
    const def = await this.defaults.getQuotaDefaults();
    return surface === "playground"
      ? def.defaultPlaygroundMonthly
      : def.defaultSkillGenMonthly;
  }

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
    const { monthMarker } = monthBounds(now);
    const [bucket, currentDefault] = await Promise.all([
      this.repo.findBucket(params.userId, params.surface, monthMarker),
      this.resolveDefault(params.surface),
    ]);
    const stored = bucket?.defaultAllotment ?? 0;
    const effectiveDefault = Math.max(stored, currentDefault);
    const adminGrant = bucket?.adminGrant ?? 0;
    const used = bucket?.used ?? 0;
    if (used < effectiveDefault + adminGrant) {
      return { allowed: true, isAdminBypass: false };
    }
    return {
      allowed: false,
      isAdminBypass: false,
      surface: params.surface,
      message: buildOverLimitMessage(params.surface),
    };
  }

  async chargeOnCompletion(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: Surface;
    outcome: ChargeOutcome;
    modelId?: string | null;
    now?: Date;
  }): Promise<void> {
    if (this.isAdmin(params.permissions)) return;
    if (params.outcome === "system_error") return;
    const now = params.now ?? new Date();
    const def = await this.resolveDefault(params.surface);
    await this.repo.incrementUsed({
      userId: params.userId,
      surface: params.surface,
      modelId: params.modelId,
      defaultAllotment: def,
      now,
    });
    logger.debug(
      {
        userId: params.userId,
        surface: params.surface,
        modelId: params.modelId ?? "__unknown__",
        outcome: params.outcome,
      },
      "Quota charged",
    );
  }

  async grant(params: {
    admin: { userId: string; email: string; displayName: string };
    targetUserId: string;
    surface: Surface;
    amount: number;
    note?: string;
    now?: Date;
  }): Promise<{ auditId: string; monthMarker: string; newAdminGrant: number }> {
    if (!Number.isInteger(params.amount) || params.amount <= 0) {
      throw new Error(`Grant amount must be a positive integer (got ${params.amount})`);
    }
    if (params.amount > 100_000) {
      throw new Error(`Grant amount must be ≤ 100000 (got ${params.amount})`);
    }
    const now = params.now ?? new Date();
    const def = await this.resolveDefault(params.surface);
    const { monthMarker } = monthBounds(now);

    const bucket = await this.repo.incrementAdminGrant({
      userId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      defaultAllotment: def,
      now,
    });
    const auditId = await this.repo.appendGrantAudit({
      adminUserId: params.admin.userId,
      adminEmail: params.admin.email,
      adminDisplayName: params.admin.displayName,
      targetUserId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      // exactOptionalPropertyTypes (#657)
      ...(params.note !== undefined ? { note: params.note } : {}),
      monthMarker,
      createdAt: now,
    });

    logger.info(
      {
        adminUserId: params.admin.userId,
        targetUserId: params.targetUserId,
        surface: params.surface,
        amount: params.amount,
        monthMarker,
        newAdminGrant: bucket.adminGrant,
      },
      "Quota grant applied",
    );

    if (this.notificationService) {
      this.notificationService
        .notifyQuotaCreditsGranted({
          targetUserId: params.targetUserId,
          surface: params.surface,
          amount: params.amount,
          // exactOptionalPropertyTypes (#657)
          ...(params.note !== undefined ? { note: params.note } : {}),
          adminDisplayName: params.admin.displayName,
        })
        .catch((err: unknown) => {
          logger.warn(
            { err, targetUserId: params.targetUserId },
            "Failed to enqueue credits-granted notification",
          );
        });
    }

    return { auditId, monthMarker, newAdminGrant: bucket.adminGrant };
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
          // exactOptionalPropertyTypes (#657)
          ...(params.note !== undefined ? { note: params.note } : {}),
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

  async getSnapshot(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    now?: Date;
  }): Promise<QuotaSnapshot> {
    const now = params.now ?? new Date();
    const isAdmin = this.isAdmin(params.permissions);
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const def = await this.defaults.getQuotaDefaults();
    const [pgBucket, sgBucket] = await Promise.all([
      this.repo.findBucket(params.userId, "playground", monthMarker),
      this.repo.findBucket(params.userId, "skillGen", monthMarker),
    ]);
    return {
      isAdmin,
      monthMarker,
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      nextMonthlyResetAt: nextMonthlyResetAt(now).toISOString(),
      playground: this.buildSurfaceSnapshot(pgBucket, def.defaultPlaygroundMonthly),
      skillGen: this.buildSurfaceSnapshot(sgBucket, def.defaultSkillGenMonthly),
    };
  }

  async getLifetime(
    userId: string,
    surface: Surface,
  ): Promise<QuotaBucketDoc[]> {
    return this.repo.findLifetime(userId, surface);
  }

  async listGrantAudit(params: {
    page: number;
    pageSize: number;
    targetUserId?: string;
    adminUserId?: string;
  }) {
    return this.repo.listGrantAudit(params);
  }

  async findBucket(
    userId: string,
    surface: Surface,
    monthMarker: string,
  ): Promise<QuotaBucketDoc | null> {
    return this.repo.findBucket(userId, surface, monthMarker);
  }

  private buildSurfaceSnapshot(
    bucket: QuotaBucketDoc | null,
    currentDefault: number,
  ): SurfaceSnapshot {
    const stored = bucket?.defaultAllotment ?? 0;
    const effectiveDefault = Math.max(stored, currentDefault);
    const adminGrant = bucket?.adminGrant ?? 0;
    const used = bucket?.used ?? 0;
    const cap = effectiveDefault + adminGrant;
    const remaining = Math.max(0, cap - used);
    const warning = cap > 0 && used >= Math.floor(cap * this.warningThreshold);
    return {
      defaultAllotment: effectiveDefault,
      adminGrant,
      used,
      remaining,
      warningThreshold: this.warningThreshold,
      warning,
    };
  }
}

function buildOverLimitMessage(surface: Surface): string {
  const surfaceLabel = surface === "playground" ? "playground" : "skill-generation";
  return `You've hit your monthly ${surfaceLabel} limit — contact admin for credits, or upgrade when paid plans launch.`;
}
