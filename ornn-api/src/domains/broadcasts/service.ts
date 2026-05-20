/**
 * Broadcast service (#500) — admin business logic on top of the
 * repository.
 *
 * Three responsibilities:
 *
 *   1. **Admin list with `readCount`.** The admin page is also a
 *      history view, so each row carries the number of distinct users
 *      that have read it. We compute counts in a single grouped query
 *      rather than fanning out N count calls.
 *
 *   2. **Lifecycle logging.** Pino `info` on create/update/delete
 *      with broadcast id + admin id; `error` on cascade failures with
 *      enough context to retry by hand. Never log the message body —
 *      content can be sensitive (announcements about incidents, etc.).
 *
 *   3. **Cascade on delete.** Hard delete is the contract; the
 *      service owns the cascade so the route layer doesn't have to
 *      know that receipts exist. If the receipt cleanup fails after
 *      the broadcast is gone we log loudly — orphan receipts are
 *      harmless (no broadcast → never surfaced) but they bloat the
 *      collection over time and operators should know.
 *
 * @module domains/broadcasts/service
 */

import { createLogger } from "../../shared/logger";
import { AppError } from "../../shared/types/index";
import type {
  BroadcastRepository,
  CreateBroadcastDocInput,
  UpdateBroadcastDocInput,
} from "./repository";
import type {
  AdminBroadcastResponse,
  BroadcastDocument,
  BroadcastI18nString,
} from "./types";

const logger = createLogger("broadcastService");

export interface BroadcastServiceDeps {
  readonly repo: BroadcastRepository;
}

export interface CreateBroadcastParams {
  titleI18n: BroadcastI18nString;
  bodyMarkdownI18n: BroadcastI18nString;
  createdBy: string;
  /**
   * Targeted recipients (#502). Omit / `undefined` → broadcast to
   * every user. Non-empty array → targeted to that user list. Empty
   * array is rejected upstream by the Zod schema; this type doesn't
   * defend against it again.
   */
  recipientUserIds?: readonly string[];
}

/**
 * Update params (#502): `recipientUserIds` is intentionally absent —
 * recipient targeting is immutable after create. Adding it on a PATCH
 * path is a compile error, matching the repository's enforcement.
 */
export interface UpdateBroadcastParams {
  titleI18n?: Partial<BroadcastI18nString>;
  bodyMarkdownI18n?: Partial<BroadcastI18nString>;
  updatedBy: string;
}

export class BroadcastService {
  private readonly repo: BroadcastRepository;

  constructor(deps: BroadcastServiceDeps) {
    this.repo = deps.repo;
  }

  /**
   * Admin list — broadcasts newest first, each row enriched with the
   * number of distinct users that have read it. Single grouped query
   * on the receipts collection covers any number of rows.
   */
  async listAdmin(): Promise<AdminBroadcastResponse[]> {
    const broadcasts = await this.repo.listAll();
    if (broadcasts.length === 0) return [];
    const counts = await this.repo.readCountsForBroadcasts(
      broadcasts.map((b) => b._id),
    );
    return broadcasts.map((b) => toAdminResponse(b, counts[b._id] ?? 0));
  }

  async getById(id: string): Promise<BroadcastDocument> {
    const doc = await this.repo.getById(id);
    if (!doc) {
      throw AppError.notFound("broadcast_not_found", "Broadcast not found");
    }
    return doc;
  }

  async create(params: CreateBroadcastParams): Promise<AdminBroadcastResponse> {
    const input: CreateBroadcastDocInput = {
      titleI18n: params.titleI18n,
      bodyMarkdownI18n: params.bodyMarkdownI18n,
      createdBy: params.createdBy,
      recipientUserIds: params.recipientUserIds,
    };
    const doc = await this.repo.create(input);
    logger.info(
      {
        broadcastId: doc._id,
        by: params.createdBy,
        // Recipient count only — never log the user_id list (it's
        // PII-adjacent and pointless for ops debugging).
        recipientCount:
          doc.recipientUserIds === null ? "all" : doc.recipientUserIds.length,
      },
      "broadcast created",
    );
    // New broadcasts have zero readers by definition — skip the count
    // query.
    return toAdminResponse(doc, 0);
  }

  async update(
    id: string,
    params: UpdateBroadcastParams,
  ): Promise<AdminBroadcastResponse> {
    const patch: UpdateBroadcastDocInput = {
      titleI18n: params.titleI18n,
      bodyMarkdownI18n: params.bodyMarkdownI18n,
      updatedBy: params.updatedBy,
    };
    const updated = await this.repo.update(id, patch);
    if (!updated) {
      throw AppError.notFound("broadcast_not_found", "Broadcast not found");
    }
    logger.info(
      { broadcastId: id, by: params.updatedBy },
      "broadcast updated",
    );
    const readCount = await this.repo.readCountForBroadcast(id);
    return toAdminResponse(updated, readCount);
  }

  /**
   * Hard delete with cascade. Order matters: delete the broadcast
   * first so a user racing on a `markRead` after the cascade pass
   * can't insert a fresh orphan receipt. If the cascade fails we log
   * with enough context for an operator to clean up by hand — the
   * orphans are harmless (no broadcast → never surface) but they
   * pile up.
   */
  async delete(id: string): Promise<void> {
    // Ensure the broadcast exists so we get a 404 rather than a silent
    // "ok, deleted nothing" on a typo.
    const removed = await this.repo.delete(id);
    if (!removed) {
      throw AppError.notFound("broadcast_not_found", "Broadcast not found");
    }
    try {
      const receiptsRemoved = await this.repo.deleteAllForBroadcast(id);
      logger.info(
        { broadcastId: id, receiptsRemoved },
        "broadcast deleted + receipts cascaded",
      );
    } catch (err) {
      logger.error(
        { broadcastId: id, err: err instanceof Error ? err.message : String(err) },
        "broadcast deleted but receipt cascade FAILED — orphan receipts left in collection",
      );
      // Don't rethrow — the user-visible delete succeeded. Orphans are
      // a cleanup concern, not a request failure.
    }
  }
}

function toAdminResponse(
  doc: BroadcastDocument,
  readCount: number,
): AdminBroadcastResponse {
  return {
    id: doc._id,
    titleI18n: doc.titleI18n,
    bodyMarkdownI18n: doc.bodyMarkdownI18n,
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    // Normalise `undefined` (defence in depth — the repo mapper
    // already does this for absent fields) into `null` so the wire
    // shape is `string[] | null`, never `undefined`.
    recipientUserIds: doc.recipientUserIds ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    readCount,
  };
}
