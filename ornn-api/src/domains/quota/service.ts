/**
 * Quota policy on the calendar-month bucket model.
 *
 *   - Admins (`ornn:admin:skill`) bypass entirely.
 *   - `checkAllowed` atomically *reserves* a slot (#808): a cap-guarded
 *     `$inc` on `used`, so concurrent requests at the cap boundary can't
 *     all pass the check and over-spend. Returns the allow/deny decision.
 *   - `chargeOnCompletion` reconciles the reservation by outcome:
 *     `system_error` (incl. abort) → release (refund the slot);
 *     `success` / `skill_error` → commit the per-model tally. `used`
 *     was already bumped at reserve time and is not touched again.
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
  type GrantableSurface,
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
  /**
   * Ornn Assistant monthly default (#970). Optional so existing
   * `QuotaDefaultsResolver` mocks keep compiling; the production resolver
   * always supplies it from `assistant.defaultMonthlyQuota`. When absent,
   * the assistant surface resolves to a 0 allotment (fail-closed: every
   * non-admin assistant call is denied until the default is wired).
   */
  defaultAssistantMonthly?: number;
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
    switch (surface) {
      case "playground":
        return def.defaultPlaygroundMonthly;
      case "skillGen":
        return def.defaultSkillGenMonthly;
      case "assistant":
        return def.defaultAssistantMonthly ?? 0;
    }
  }

  /**
   * Atomically reserve a slot before the LLM call. The reservation IS
   * the charge — it bumps `used` under a cap guard so concurrent
   * requests at the boundary can't all be admitted (#808, CWE-367).
   * A reservation that doesn't reach a chargeable outcome is refunded
   * by `chargeOnCompletion` (`system_error`/abort → release).
   *
   * Admins bypass entirely: no reservation is taken and none is
   * released, so their runs never touch a bucket.
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
    // The bucket stores the first-touch default; the runtime-effective
    // default may be higher if the admin raised it mid-month. The repo
    // guards against `adminGrant + effectiveDefault`, reading the bucket's
    // own `adminGrant` inside the atomic update.
    const currentDefault = await this.resolveDefault(params.surface);
    const existing = await this.repo.findBucket(
      params.userId,
      params.surface,
      monthBounds(now).monthMarker,
    );
    const stored = existing?.defaultAllotment ?? 0;
    const effectiveDefault = Math.max(stored, currentDefault);

    const reserved = await this.repo.reserveSlot({
      userId: params.userId,
      surface: params.surface,
      effectiveDefault,
      now,
    });

    if (reserved) {
      logger.info(
        { userId: params.userId, surface: params.surface },
        "Quota slot reserved",
      );
      return { allowed: true, isAdminBypass: false };
    }

    logger.info(
      { userId: params.userId, surface: params.surface },
      "Quota denied — cap reached",
    );
    return {
      allowed: false,
      isAdminBypass: false,
      surface: params.surface,
      message: buildOverLimitMessage(params.surface),
    };
  }

  /**
   * Reconcile a reservation once the run terminates. The slot was
   * already taken at `checkAllowed` time, so this never bumps `used`:
   *  - `system_error` (LLM timeout, infra 5xx, client abort) → release
   *    the slot (refund), since the request never reached the skill.
   *  - `success` / `skill_error` → commit the per-model tally; the slot
   *    stays consumed.
   * Admins took no reservation, so this is a no-op for them.
   */
  async chargeOnCompletion(params: {
    userId: string;
    permissions: readonly string[] | undefined;
    surface: Surface;
    outcome: ChargeOutcome;
    modelId?: string | null;
    now?: Date;
  }): Promise<void> {
    if (this.isAdmin(params.permissions)) return;
    const now = params.now ?? new Date();

    if (params.outcome === "system_error") {
      await this.repo.releaseSlot({
        userId: params.userId,
        surface: params.surface,
        now,
      });
      logger.info(
        { userId: params.userId, surface: params.surface, outcome: params.outcome },
        "Quota reservation released",
      );
      return;
    }

    await this.repo.commitModel({
      userId: params.userId,
      surface: params.surface,
      modelId: params.modelId,
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
    surface: GrantableSurface;
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
    surface: GrantableSurface;
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
  const surfaceLabel =
    surface === "playground"
      ? "playground"
      : surface === "skillGen"
        ? "skill-generation"
        : "assistant";
  return `You've hit your monthly ${surfaceLabel} limit — contact admin for credits, or upgrade when paid plans launch.`;
}
