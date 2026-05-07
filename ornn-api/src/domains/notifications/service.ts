/**
 * Notification service.
 *
 * Two notification categories today:
 *   - `audit.completed`         — every audit run, sent to the owner only.
 *   - `audit.risky_for_consumer` — yellow/red audit, sent to every user the
 *                                  skill has been shared with (so they
 *                                  know what they have access to is risky).
 *
 * Sharing is unconditional in v2 — there is no waiver / review flow, so
 * no share-lifecycle notifications.
 *
 * @module domains/notifications/service
 */

import pino from "pino";
import { AppError } from "../../shared/types/index";
import type { NotificationRepository } from "./repository";
import type { NotificationDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "notificationService" });

export interface NotificationServiceDeps {
  readonly notificationRepo: NotificationRepository;
}

export class NotificationService {
  private readonly repo: NotificationRepository;

  constructor(deps: NotificationServiceDeps) {
    this.repo = deps.notificationRepo;
  }

  // ---- Query API ---------------------------------------------------------

  async list(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}): Promise<NotificationDocument[]> {
    return this.repo.list(userId, options);
  }

  async countUnread(userId: string): Promise<number> {
    return this.repo.countUnread(userId);
  }

  async markRead(userId: string, notificationId: string): Promise<NotificationDocument> {
    const updated = await this.repo.markRead(userId, notificationId);
    if (!updated) {
      throw AppError.notFound("NOTIFICATION_NOT_FOUND", "Notification not found");
    }
    return updated;
  }

  async markAllRead(userId: string): Promise<number> {
    return this.repo.markAllRead(userId);
  }

  // ---- Emitter helpers ---------------------------------------------------

  /**
   * Owner-side notification fired every time an audit completes.
   * Green → "passed"; yellow/red → "flagged risk, review findings".
   */
  async notifyAuditCompleted(params: {
    ownerUserId: string;
    skillGuid: string;
    skillName: string;
    version: string;
    verdict: "green" | "yellow" | "red";
    overallScore: number;
  }): Promise<void> {
    const score = params.overallScore.toFixed(1);
    const title =
      params.verdict === "green"
        ? `Skill audit passed — ${params.skillName} v${params.version} · score ${score}/10`
        : `Skill audit flagged risk — ${params.skillName} v${params.version} · score ${score}/10`;
    const body =
      params.verdict === "green"
        ? "Audit verdict was green. No follow-up required."
        : "Audit found one or more flagged areas. Review the findings before continuing to share.";
    await this.emit(params.ownerUserId, {
      category: "audit.completed",
      title,
      body,
      link: `/skills/${encodeURIComponent(params.skillGuid)}/audits?version=${encodeURIComponent(params.version)}`,
      data: {
        skillGuid: params.skillGuid,
        skillName: params.skillName,
        version: params.version,
        verdict: params.verdict,
        overallScore: params.overallScore,
      },
    });
  }

  /**
   * Consumer-side notification — fired only on yellow/red verdicts, sent
   * to every user the skill is currently shared with (orgs are expanded
   * to their members at the call site).
   */
  async notifyAuditRiskyForConsumer(params: {
    consumerUserId: string;
    skillGuid: string;
    skillName: string;
    version: string;
    verdict: "yellow" | "red";
    overallScore: number;
  }): Promise<void> {
    const score = params.overallScore.toFixed(1);
    const title = `Skill "${params.skillName}" v${params.version} you have access to was flagged risky in audit`;
    const body = `Verdict: ${params.verdict} · score ${score}/10. Use with caution.`;
    await this.emit(params.consumerUserId, {
      category: "audit.risky_for_consumer",
      title,
      body,
      link: `/skills/${encodeURIComponent(params.skillGuid)}/audits?version=${encodeURIComponent(params.version)}`,
      data: {
        skillGuid: params.skillGuid,
        skillName: params.skillName,
        version: params.version,
        verdict: params.verdict,
        overallScore: params.overallScore,
      },
    });
  }

  /**
   * Recipient-side notification fired every time an admin grants credits
   * (single or bulk path) to a user's playground / skill-gen surface.
   * Surfaces the new balance so the user knows what they just received.
   */
  async notifyQuotaCreditsGranted(params: {
    targetUserId: string;
    surface: "playground" | "skillGen";
    amount: number;
    note?: string;
    adminDisplayName: string;
  }): Promise<void> {
    const surfaceLabel =
      params.surface === "playground" ? "playground" : "skill-generation";
    const amountStr = params.amount.toLocaleString("en-US");
    const title = `Admin granted you +${amountStr} ${surfaceLabel} credits`;
    const body = params.note
      ? `Granted by ${params.adminDisplayName}. Note: ${params.note}`
      : `Granted by ${params.adminDisplayName}. Credits never expire and stack on top of your monthly base.`;
    await this.emit(params.targetUserId, {
      category: "quota.credits_granted",
      title,
      body,
      // No deep link target today — settings/profile would be the
      // closest match; leaving undefined so the bell renders the
      // notification without a click affordance.
      data: {
        surface: params.surface,
        amount: params.amount,
        adminDisplayName: params.adminDisplayName,
      },
    });
  }

  /**
   * One-time notice fired by the quota migration script (Story 10.3) for
   * each user who held a multi-month grant under the old time-period
   * model. Tells them their grants now expire at month-end so they
   * aren't surprised when next-month bucket starts at zero. The
   * `monthMarker` is the calendar month their existing credits will
   * still last through (e.g. "2026-05" for credits valid until
   * 2026-05-31).
   */
  async notifyQuotaModelChange(params: {
    targetUserId: string;
    monthMarker: string;
  }): Promise<void> {
    const title = "Quota model update — your existing credits expire at month end";
    const body =
      `Your previously granted credits have been migrated to current-month-only credits ` +
      `ending ${params.monthMarker}. Contact admin if you need them re-issued next month.`;
    await this.emit(params.targetUserId, {
      category: "quota.credits_granted",
      title,
      body,
      data: { kind: "model_change", monthMarker: params.monthMarker },
    });
  }

  private async emit(
    userId: string,
    payload: {
      category: NotificationDocument["category"];
      title: string;
      body?: string;
      link?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.repo.create({ userId, ...payload });
    } catch (err) {
      // Notifications must never block the caller. Log and swallow.
      logger.warn({ err, userId, category: payload.category }, "Failed to persist notification");
    }
  }
}
