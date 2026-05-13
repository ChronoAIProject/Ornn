/**
 * Broadcast repository (#500) — two Mongo collections:
 *
 *   - `broadcasts`               — the broadcast docs themselves.
 *   - `broadcast_read_receipts`  — `(userId, broadcastId)` rows
 *                                  recording which user read which
 *                                  broadcast and when.
 *
 * Receipts live in a separate collection rather than embedded on the
 * broadcast doc so the write rate scales with (users × broadcasts)
 * instead of mutating a single hot doc on every read. A `(userId,
 * broadcastId)` unique index makes mark-read idempotent — repeat
 * writes upsert onto the existing row.
 *
 * `delete()` on a broadcast is intentionally NOT cascading at the repo
 * level — the service layer owns the cascade contract so the call site
 * is explicit and testable. Use `deleteAllForBroadcast()` to clear
 * receipts.
 *
 * @module domains/broadcasts/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type {
  BroadcastDocument,
  BroadcastI18nString,
  BroadcastReadReceiptDocument,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "broadcastRepository" });

export interface CreateBroadcastDocInput {
  titleI18n: BroadcastI18nString;
  bodyMarkdownI18n: BroadcastI18nString;
  createdBy: string;
}

export interface UpdateBroadcastDocInput {
  titleI18n?: Partial<BroadcastI18nString>;
  bodyMarkdownI18n?: Partial<BroadcastI18nString>;
  updatedBy: string;
}

export class BroadcastRepository {
  private readonly broadcasts: Collection;
  private readonly receipts: Collection;

  constructor(db: Db) {
    this.broadcasts = db.collection("broadcasts");
    this.receipts = db.collection("broadcast_read_receipts");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.broadcasts.createIndex({ createdAt: -1 }),
        // Per-user receipt uniqueness — repeat markRead writes collapse
        // onto the existing row via upsert rather than inserting dups.
        this.receipts.createIndex(
          { userId: 1, broadcastId: 1 },
          { unique: true, name: "userId_broadcastId_unique" },
        ),
        // Fast "what has this broadcast been read by" + "what has this
        // user already read" reverse scans. Cheap; cardinality is small.
        this.receipts.createIndex({ broadcastId: 1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create broadcasts indexes");
    }
  }

  // ---- Broadcasts ---------------------------------------------------------

  async create(input: CreateBroadcastDocInput): Promise<BroadcastDocument> {
    const now = new Date();
    const doc: Document = {
      _id: randomUUID() as unknown as Document["_id"],
      titleI18n: { en: input.titleI18n.en, zh: input.titleI18n.zh },
      bodyMarkdownI18n: {
        en: input.bodyMarkdownI18n.en,
        zh: input.bodyMarkdownI18n.zh,
      },
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    await this.broadcasts.insertOne(doc);
    logger.debug({ broadcastId: String(doc._id) }, "broadcast inserted");
    return mapBroadcastDoc(doc)!;
  }

  async listAll(): Promise<BroadcastDocument[]> {
    const docs = await this.broadcasts.find({}).sort({ createdAt: -1 }).toArray();
    return docs.map((d) => mapBroadcastDoc(d)!);
  }

  async getById(id: string): Promise<BroadcastDocument | null> {
    const doc = await this.broadcasts.findOne({ _id: id as unknown as Document["_id"] });
    return mapBroadcastDoc(doc);
  }

  async update(
    id: string,
    patch: UpdateBroadcastDocInput,
  ): Promise<BroadcastDocument | null> {
    // Per-locale partial patch. We need a fresh read to compute the
    // merged i18n payload because Mongo's `$set` on nested objects
    // replaces the whole object — `{ $set: { "titleI18n.en": x } }`
    // works but leaves us juggling dot-paths. Read+merge keeps the
    // service logic readable; the volume here is tiny.
    const existing = await this.getById(id);
    if (!existing) return null;
    const $set: Record<string, unknown> = {
      updatedAt: new Date(),
      updatedBy: patch.updatedBy,
    };
    if (patch.titleI18n) {
      $set.titleI18n = {
        en: patch.titleI18n.en ?? existing.titleI18n.en,
        zh: patch.titleI18n.zh ?? existing.titleI18n.zh,
      };
    }
    if (patch.bodyMarkdownI18n) {
      $set.bodyMarkdownI18n = {
        en: patch.bodyMarkdownI18n.en ?? existing.bodyMarkdownI18n.en,
        zh: patch.bodyMarkdownI18n.zh ?? existing.bodyMarkdownI18n.zh,
      };
    }
    await this.broadcasts.updateOne(
      { _id: id as unknown as Document["_id"] },
      { $set },
    );
    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.broadcasts.deleteOne({
      _id: id as unknown as Document["_id"],
    });
    return (res.deletedCount ?? 0) > 0;
  }

  // ---- Read receipts ------------------------------------------------------

  /**
   * Idempotent mark-read. Returns the (possibly pre-existing) receipt
   * row. `(userId, broadcastId)` unique index guarantees a single row;
   * `$setOnInsert` ensures the original `readAt` timestamp wins on
   * repeat writes (we don't bump it — first-read time is the meaningful
   * value).
   */
  async markRead(userId: string, broadcastId: string): Promise<BroadcastReadReceiptDocument> {
    const now = new Date();
    await this.receipts.updateOne(
      { userId, broadcastId },
      {
        $setOnInsert: {
          _id: randomUUID() as unknown as Document["_id"],
          userId,
          broadcastId,
          readAt: now,
        },
      },
      { upsert: true },
    );
    const doc = await this.receipts.findOne({ userId, broadcastId });
    return mapReceiptDoc(doc)!;
  }

  /**
   * Batch markRead — used by `notifications.markAllRead`. Returns the
   * number of new receipts written. Existing receipts are left alone
   * (idempotent).
   */
  async markManyRead(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<number> {
    if (broadcastIds.length === 0) return 0;
    // Find which ids are still unread so we know how many to insert.
    const existing = await this.receipts
      .find({ userId, broadcastId: { $in: [...broadcastIds] } })
      .project({ broadcastId: 1 })
      .toArray();
    const seen = new Set(existing.map((r) => String(r.broadcastId)));
    const toInsert = broadcastIds.filter((id) => !seen.has(id));
    if (toInsert.length === 0) return 0;
    const now = new Date();
    const docs: Document[] = toInsert.map((broadcastId) => ({
      _id: randomUUID() as unknown as Document["_id"],
      userId,
      broadcastId,
      readAt: now,
    }));
    // `ordered: false` so a unique-key race against a parallel
    // markRead doesn't abort the whole batch — duplicates are silently
    // skipped (the row already exists, which is what we wanted).
    try {
      const res = await this.receipts.insertMany(docs, { ordered: false });
      return res.insertedCount ?? toInsert.length;
    } catch (err) {
      // Duplicate-key under race → some inserts still went through
      // and the rest are no-ops, which matches our idempotent intent.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: number }).code === 11000
      ) {
        logger.debug(
          { userId, attempted: toInsert.length },
          "markManyRead: dup-key races collapsed (idempotent)",
        );
        return 0;
      }
      throw err;
    }
  }

  async deleteAllForBroadcast(broadcastId: string): Promise<number> {
    const res = await this.receipts.deleteMany({ broadcastId });
    return res.deletedCount ?? 0;
  }

  async readCountForBroadcast(broadcastId: string): Promise<number> {
    return this.receipts.countDocuments({ broadcastId });
  }

  /**
   * Returns the ids of broadcasts the user has NOT read yet. The
   * caller (notifications service) uses this for the unread-count
   * roll-up and to know which receipts to insert on markAllRead.
   */
  async unreadBroadcastIdsForUser(userId: string): Promise<string[]> {
    // Cheap two-step: enumerate every broadcast id, subtract the ones
    // the user has receipts for. Broadcast count is bounded (<< 1k);
    // a more aggressive `$lookup` would be premature.
    const broadcastIds = await this.broadcasts
      .find({})
      .project({ _id: 1 })
      .toArray();
    if (broadcastIds.length === 0) return [];
    const allIds = broadcastIds.map((d) => String(d._id));
    const receipts = await this.receipts
      .find({ userId, broadcastId: { $in: allIds } })
      .project({ broadcastId: 1 })
      .toArray();
    const readSet = new Set(receipts.map((r) => String(r.broadcastId)));
    return allIds.filter((id) => !readSet.has(id));
  }

  /**
   * Bulk-resolve "has this user read these broadcasts" for the feed
   * merge in the notifications service. Returns a map keyed by
   * broadcastId; entries present with a `Date` mean read; missing
   * entries mean unread. Ids absent from the input list are absent
   * from the output — no synthesised `undefined`s.
   */
  async hasUserReadBroadcastsMap(
    userId: string,
    broadcastIds: readonly string[],
  ): Promise<Record<string, Date | undefined>> {
    if (broadcastIds.length === 0) return {};
    const docs = await this.receipts
      .find({ userId, broadcastId: { $in: [...broadcastIds] } })
      .project({ broadcastId: 1, readAt: 1 })
      .toArray();
    const out: Record<string, Date | undefined> = {};
    for (const doc of docs) {
      const readAt = doc.readAt;
      out[String(doc.broadcastId)] =
        readAt instanceof Date ? readAt : new Date(readAt as string | number);
    }
    return out;
  }

  /**
   * Bulk read-count helper for the admin list. Single `$group` over
   * the receipts collection so we don't fan out N count queries when
   * the list has N rows. Broadcasts with zero receipts simply don't
   * appear in the output — the caller defaults to 0.
   */
  async readCountsForBroadcasts(
    broadcastIds: readonly string[],
  ): Promise<Record<string, number>> {
    if (broadcastIds.length === 0) return {};
    const rows = await this.receipts
      .aggregate<{ _id: string; count: number }>([
        { $match: { broadcastId: { $in: [...broadcastIds] } } },
        { $group: { _id: "$broadcastId", count: { $sum: 1 } } },
      ])
      .toArray();
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r._id)] = r.count;
    return out;
  }
}

function mapBroadcastDoc(doc: Document | null): BroadcastDocument | null {
  if (!doc) return null;
  const titleI18n = (doc.titleI18n as Partial<BroadcastI18nString>) ?? {};
  const bodyI18n = (doc.bodyMarkdownI18n as Partial<BroadcastI18nString>) ?? {};
  return {
    _id: String(doc._id),
    titleI18n: {
      en: typeof titleI18n.en === "string" ? titleI18n.en : "",
      zh: typeof titleI18n.zh === "string" ? titleI18n.zh : "",
    },
    bodyMarkdownI18n: {
      en: typeof bodyI18n.en === "string" ? bodyI18n.en : "",
      zh: typeof bodyI18n.zh === "string" ? bodyI18n.zh : "",
    },
    createdBy: String(doc.createdBy ?? ""),
    updatedBy: String(doc.updatedBy ?? doc.createdBy ?? ""),
    createdAt: toDate(doc.createdAt),
    updatedAt: toDate(doc.updatedAt ?? doc.createdAt),
  };
}

function mapReceiptDoc(doc: Document | null): BroadcastReadReceiptDocument | null {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    userId: String(doc.userId),
    broadcastId: String(doc.broadcastId),
    readAt: toDate(doc.readAt),
  };
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(v as string | number);
}
