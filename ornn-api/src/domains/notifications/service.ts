/**
 * Notification service.
 *
 * Thin wrapper around the repository with typed helpers for the specific
 * categories the audit/share flow emits. Keeping helpers here (not in
 * `ShareService`) means the share service takes only a
 * `NotificationService` dependency — no knowledge of the wire format or
 * deep-link paths.
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

  async notifyAuditCompleted(params: {
    ownerUserId: string;
    skillGuid: string;
    skillName: string;
    version: string;
    verdict: "green" | "yellow" | "red";
    shareRequestId?: string;
  }): Promise<void> {
    const title =
      params.verdict === "green"
        ? `Audit passed — ${params.skillName} v${params.version}`
        : `Audit did not pass — ${params.skillName} v${params.version}`;
    const body =
      params.verdict === "green"
        ? "Your skill passed audit and can be shared without review."
        : "Your skill did not pass audit. Submit justifications to request review.";
    const link = params.shareRequestId ? `/shares/${params.shareRequestId}` : `/skills/${params.skillGuid}`;
    await this.emit(params.ownerUserId, {
      category: "audit.completed",
      title,
      body,
      link,
      data: {
        skillGuid: params.skillGuid,
        skillName: params.skillName,
        version: params.version,
        verdict: params.verdict,
        shareRequestId: params.shareRequestId,
      },
    });
  }

  async notifyNeedsJustification(params: {
    ownerUserId: string;
    shareRequestId: string;
    skillName: string;
  }): Promise<void> {
    await this.emit(params.ownerUserId, {
      category: "share.needs_justification",
      title: `Justification needed to share ${params.skillName}`,
      body: "Answer three short questions so a reviewer can decide.",
      link: `/shares/${params.shareRequestId}`,
      data: { shareRequestId: params.shareRequestId, skillName: params.skillName },
    });
  }

  async notifyReviewRequested(params: {
    reviewerUserId: string;
    shareRequestId: string;
    skillName: string;
    ownerDisplayName: string;
    targetType: "user" | "org" | "public";
  }): Promise<void> {
    const scopeWord =
      params.targetType === "public"
        ? "publicly"
        : params.targetType === "org"
          ? "in this org"
          : "with you";
    await this.emit(params.reviewerUserId, {
      category: "share.review_requested",
      title: `Review: ${params.ownerDisplayName} wants to share ${params.skillName}`,
      body: `${params.ownerDisplayName} tried to share a skill ${scopeWord}, but it did not pass audit. Review their justifications.`,
      link: `/shares/${params.shareRequestId}`,
      data: {
        shareRequestId: params.shareRequestId,
        skillName: params.skillName,
        ownerDisplayName: params.ownerDisplayName,
        targetType: params.targetType,
      },
    });
  }

  async notifyShareDecision(params: {
    ownerUserId: string;
    shareRequestId: string;
    skillName: string;
    decision: "accept" | "reject";
    reviewerDisplayName?: string;
  }): Promise<void> {
    const category = params.decision === "accept" ? "share.accepted" : "share.rejected";
    const title =
      params.decision === "accept"
        ? `Share accepted — ${params.skillName}`
        : `Share rejected — ${params.skillName}`;
    const body = params.reviewerDisplayName
      ? `${params.reviewerDisplayName} ${params.decision}ed your share request.`
      : undefined;
    await this.emit(params.ownerUserId, {
      category,
      title,
      body,
      link: `/shares/${params.shareRequestId}`,
      data: {
        shareRequestId: params.shareRequestId,
        skillName: params.skillName,
        decision: params.decision,
      },
    });
  }

  async notifyShareCancelled(params: {
    ownerUserId: string;
    shareRequestId: string;
    skillName: string;
  }): Promise<void> {
    await this.emit(params.ownerUserId, {
      category: "share.cancelled",
      title: `Share cancelled — ${params.skillName}`,
      link: `/shares/${params.shareRequestId}`,
      data: {
        shareRequestId: params.shareRequestId,
        skillName: params.skillName,
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
