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
import type { BroadcastRepository } from "../broadcasts/repository";
import type { NotificationRepository } from "./repository";
import type { FeedItem, NotificationDocument } from "./types";

const logger = pino({ level: "info" }).child({ module: "notificationService" });

/** Per-page cap on the merged feed. Matches the existing repo cap. */
const MERGED_FEED_LIMIT_MAX = 200;
/** Default page size when the caller doesn't pass `?limit=`. */
const MERGED_FEED_LIMIT_DEFAULT = 50;

export interface NotificationServiceDeps {
  readonly notificationRepo: NotificationRepository;
  /**
   * Broadcasts repo (#500). Optional in the type signature only so
   * existing tests that build a NotificationService without broadcasts
   * keep compiling; production bootstrap always wires it. When absent
   * the service behaves exactly as it did pre-#500.
   */
  readonly broadcastRepo?: BroadcastRepository;
}

export class NotificationService {
  private readonly repo: NotificationRepository;
  private readonly broadcastRepo: BroadcastRepository | undefined;

  constructor(deps: NotificationServiceDeps) {
    this.repo = deps.notificationRepo;
    this.broadcastRepo = deps.broadcastRepo;
  }

  // ---- Query API ---------------------------------------------------------

  /**
   * Legacy single-source list — returns only `notifications` rows.
   * Kept for any internal caller that still wants the typed
   * `NotificationDocument[]`. The user-facing `/notifications`
   * route uses `listFeedForUser` instead so broadcasts show up.
   */
  async list(userId: string, options: { limit?: number; unreadOnly?: boolean } = {}): Promise<NotificationDocument[]> {
    return this.repo.list(userId, options);
  }

  /**
   * Merged user-facing feed: per-user notifications + every broadcast,
   * with each broadcast's read state left-joined from the receipts
   * collection. Returned as a discriminated union (`source: "user"` |
   * `source: "broadcast"`) so the UI can render each kind correctly
   * without a separate request.
   *
   * Sort is `createdAt` desc across the union — broadcast and per-user
   * items interleave on real wall-clock time. `unreadOnly` excludes:
   *   - per-user rows where `readAt != null`
   *   - broadcast rows the user has a receipt for
   *
   * Cap is the union of both source caps so a chatty admin can't
   * starve per-user notifications out of the feed (and vice versa).
   * Falls back to legacy behaviour (per-user only) when no broadcasts
   * repo is wired — useful for tests that pre-date #500.
   */
  async listFeedForUser(
    userId: string,
    options: { limit?: number; unreadOnly?: boolean } = {},
  ): Promise<FeedItem[]> {
    const limit = Math.max(
      1,
      Math.min(MERGED_FEED_LIMIT_MAX, options.limit ?? MERGED_FEED_LIMIT_DEFAULT),
    );
    // Pull `limit` from each source, then take the top `limit` after
    // merging — guarantees we don't drop a newer item from one source
    // because the other source had `limit` older items.
    const perUser = await this.repo.list(userId, {
      limit,
      unreadOnly: options.unreadOnly,
    });
    const userItems: FeedItem[] = perUser.map((n) => ({ ...n, source: "user" }));

    let broadcastItems: FeedItem[] = [];
    if (this.broadcastRepo) {
      const broadcasts = await this.broadcastRepo.listAll();
      if (broadcasts.length > 0) {
        const readMap = await this.broadcastRepo.hasUserReadBroadcastsMap(
          userId,
          broadcasts.map((b) => b._id),
        );
        for (const b of broadcasts) {
          const readAt = readMap[b._id] ?? null;
          if (options.unreadOnly && readAt) continue;
          broadcastItems.push({
            _id: b._id,
            source: "broadcast",
            titleI18n: b.titleI18n,
            bodyMarkdownI18n: b.bodyMarkdownI18n,
            createdAt: b.createdAt,
            readAt,
          });
        }
      }
    }

    const merged = [...userItems, ...broadcastItems];
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return merged.slice(0, limit);
  }

  async countUnread(userId: string): Promise<number> {
    const perUser = await this.repo.countUnread(userId);
    if (!this.broadcastRepo) return perUser;
    const unreadBroadcasts = await this.broadcastRepo.unreadBroadcastIdsForUser(userId);
    return perUser + unreadBroadcasts.length;
  }

  /**
   * Mark a single notification or broadcast as read for the caller.
   *
   * The id type is resolved by lookup: if the id matches a row the
   * caller owns in `notifications`, treat it as a per-user
   * notification. Otherwise — if a `broadcasts` row exists with that
   * id and a broadcasts repo is wired — insert/upsert a receipt.
   *
   * If neither matches, throw NOTIFICATION_NOT_FOUND. Routes can
   * catch and 404, or in the batch context (`markManyRead`) skip the
   * id — see that method's docstring.
   */
  async markRead(userId: string, id: string): Promise<NotificationDocument | { source: "broadcast"; readAt: Date }> {
    // Try per-user first — it's the common case (audit / quota
    // events fire orders of magnitude more often than broadcasts).
    const updated = await this.repo.markRead(userId, id);
    if (updated) return updated;
    if (this.broadcastRepo) {
      const broadcast = await this.broadcastRepo.getById(id);
      if (broadcast) {
        const receipt = await this.broadcastRepo.markRead(userId, id);
        logger.debug(
          { userId, broadcastId: id },
          "broadcast marked read via /notifications/:id/read",
        );
        return { source: "broadcast", readAt: receipt.readAt };
      }
    }
    throw AppError.notFound("NOTIFICATION_NOT_FOUND", "Notification not found");
  }

  /**
   * Batch mark-read for a mixed bag of per-user notification ids +
   * broadcast ids. Each id is routed independently. Unknown ids are
   * silently skipped — the caller's intent is "ensure these are
   * marked read", so a typo or a row that vanished between fetch and
   * write shouldn't fail the whole batch.
   *
   * Returns the count of ids that actually transitioned to "read"
   * (existing already-read ids count as 0). Useful for the UI to
   * decrement the unread badge.
   */
  async markManyRead(userId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let changed = 0;
    const broadcastIds: string[] = [];
    for (const id of ids) {
      const updated = await this.repo.markRead(userId, id);
      if (updated) {
        changed++;
      } else if (this.broadcastRepo) {
        // Defer broadcast ids so we can mark them in one batch.
        broadcastIds.push(id);
      }
      // Else: unknown id — skip silently per the contract above.
    }
    if (broadcastIds.length > 0 && this.broadcastRepo) {
      // Filter out ids that don't actually exist in `broadcasts` to
      // avoid inserting receipts for typos.
      const existing: string[] = [];
      for (const id of broadcastIds) {
        if (await this.broadcastRepo.getById(id)) existing.push(id);
      }
      if (existing.length > 0) {
        const inserted = await this.broadcastRepo.markManyRead(userId, existing);
        changed += inserted;
      }
    }
    return changed;
  }

  /**
   * Mark every unread item read — per-user notifications AND every
   * broadcast that doesn't yet have a receipt for this user. Returns
   * the total transitions across both sources.
   */
  async markAllRead(userId: string): Promise<number> {
    const perUser = await this.repo.markAllRead(userId);
    if (!this.broadcastRepo) return perUser;
    const unread = await this.broadcastRepo.unreadBroadcastIdsForUser(userId);
    const broadcasts = await this.broadcastRepo.markManyRead(userId, unread);
    return perUser + broadcasts;
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
