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
