/**
 * Mongo persistence for the calendar-month quota bucket model.
 *
 *   `quota_buckets`        — one document per (userId, surface,
 *                            monthMarker). `used` doubles as the
 *                            reservation counter: `reserveSlot` does a
 *                            cap-guarded atomic `$inc` (the TOCTOU fix,
 *                            #808), `commitModel` records the per-model
 *                            tally, `releaseSlot` refunds on failure.
 *                            `adminGrant` has its own atomic `$inc`.
 *   `quota_grants_audit`   — append-only history of admin grants
 *                            (replaces the old drainable ledger).
 *
 * @module domains/quota/repository
 */

import { MongoServerError } from "mongodb";
import type { Collection, Db } from "mongodb";
import { randomUUID } from "node:crypto";
import { createLogger } from "../../shared/logger";
import {
  type QuotaBucketDoc,
  type QuotaGrantAuditDoc,
  type Surface,
  bucketId,
  escapeModelKey,
  monthBounds,
} from "./types";

const logger = createLogger("quotaRepository");

/** Mongo duplicate-key error code (E11000). */
const DUPLICATE_KEY_CODE = 11000;

export interface ReserveSlotParams {
  userId: string;
  surface: Surface;
  /**
   * The runtime-effective default (`max(stored, currentSettingsDefault)`).
   * Combined with the bucket's `adminGrant` this forms the cap the
   * reservation is guarded against: `used < adminGrant + effectiveDefault`.
   */
  effectiveDefault: number;
  now?: Date;
}

export interface CommitModelParams {
  userId: string;
  surface: Surface;
  modelId: string | null | undefined;
  now?: Date;
}

export interface ReleaseSlotParams {
  userId: string;
  surface: Surface;
  now?: Date;
}

export interface UpsertGrantParams {
  userId: string;
  surface: Surface;
  amount: number;
  defaultAllotment: number;
  now?: Date;
}

export class QuotaRepository {
  private readonly buckets: Collection<QuotaBucketDoc>;
  private readonly audit: Collection<QuotaGrantAuditDoc>;

  constructor(db: Db) {
    this.buckets = db.collection<QuotaBucketDoc>("quota_buckets");
    this.audit = db.collection<QuotaGrantAuditDoc>("quota_grants_audit");
  }

  get bucketsCollection(): Collection<QuotaBucketDoc> {
    return this.buckets;
  }

  get auditCollection(): Collection<QuotaGrantAuditDoc> {
    return this.audit;
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.buckets.createIndex(
        { userId: 1, surface: 1, monthMarker: -1 },
        { name: "bucket_lookup" },
      );
      await this.buckets.createIndex({ monthMarker: 1 }, { name: "bucket_month" });
      await this.audit.createIndex(
        { targetUserId: 1, createdAt: -1 },
        { name: "audit_per_target" },
      );
      await this.audit.createIndex(
        { adminUserId: 1, createdAt: -1 },
        { name: "audit_per_admin" },
      );
      await this.audit.createIndex({ createdAt: -1 }, { name: "audit_recent" });
      await this.audit.createIndex(
        { monthMarker: 1, targetUserId: 1 },
        { name: "audit_lifetime" },
      );
    } catch (err) {
      logger.warn({ err }, "quota indexes ensureIndexes failed — proceeding anyway");
    }
  }

  async findBucket(
    userId: string,
    surface: Surface,
    monthMarker: string,
  ): Promise<QuotaBucketDoc | null> {
    return this.buckets.findOne({ _id: bucketId(userId, surface, monthMarker) });
  }

  async findLifetime(userId: string, surface: Surface): Promise<QuotaBucketDoc[]> {
    return this.buckets
      .find({ userId, surface })
      .sort({ monthMarker: 1 })
      .toArray();
  }

  /**
   * Atomically reserve one slot by bumping `used`, guarded by the cap
   * (`used < adminGrant + effectiveDefault`). This is the time-of-check =
   * time-of-use fix (#808): N concurrent requests at `used = cap-1` race
   * on the same conditional `$inc`, so at most one wins — the rest see
   * the guard fail and are denied. `used` doubles as the reservation
   * counter; the per-model tally is recorded later by `commitModel` and
   * a failed run refunds via `releaseSlot`.
   *
   * Returns `true` when a slot was reserved, `false` when the cap is hit.
   *
   * First-touch (no bucket yet) is handled by an insert with `used = 1`;
   * a lost insert race (E11000) retries the guarded update.
   */
  async reserveSlot(params: ReserveSlotParams): Promise<boolean> {
    const now = params.now ?? new Date();
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const id = bucketId(params.userId, params.surface, monthMarker);

    // Cap-guarded conditional increment on an existing bucket. `$expr`
    // lets the cap reference the doc's own `adminGrant`, so an admin
    // grant applied mid-month is respected without re-reading first.
    const guardedUpdate = () =>
      this.buckets.findOneAndUpdate(
        {
          _id: id,
          $expr: { $lt: ["$used", { $add: ["$adminGrant", params.effectiveDefault] }] },
        },
        { $inc: { used: 1 }, $set: { updatedAt: now } },
        { returnDocument: "after" },
      );

    const updated = await guardedUpdate();
    if (updated) return true;

    // No match: either the bucket exists and is at/over cap, or it
    // doesn't exist yet. A zero (or negative) cap can never admit the
    // first request, so don't bother creating a bucket.
    if (params.effectiveDefault < 1) return false;

    try {
      await this.buckets.insertOne({
        _id: id,
        userId: params.userId,
        surface: params.surface,
        monthMarker,
        monthStart,
        monthEnd,
        defaultAllotment: params.effectiveDefault,
        adminGrant: 0,
        used: 1,
        usedByModel: {},
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (err) {
      // Lost the insert race — another concurrent reserve created the
      // bucket first. Fall back to the guarded update and honour the cap.
      if (err instanceof MongoServerError && err.code === DUPLICATE_KEY_CODE) {
        const retry = await guardedUpdate();
        return !!retry;
      }
      throw err;
    }
  }

  /**
   * Record the per-model tally for a committed run. The slot's `used`
   * counter was already bumped by `reserveSlot`, so this only touches
   * `usedByModel.<id>` — it must NOT bump `used` again.
   */
  async commitModel(params: CommitModelParams): Promise<void> {
    const now = params.now ?? new Date();
    const { monthMarker } = monthBounds(now);
    const id = bucketId(params.userId, params.surface, monthMarker);
    const modelKey = escapeModelKey(params.modelId);
    await this.buckets.updateOne(
      { _id: id },
      { $inc: { [`usedByModel.${modelKey}`]: 1 }, $set: { updatedAt: now } },
    );
  }

  /**
   * Refund a reserved slot (e.g. the LLM call failed with a system
   * error or the client aborted). Decrements `used`, floored at 0 via
   * the `used > 0` guard so a double-release can never drive it negative.
   */
  async releaseSlot(params: ReleaseSlotParams): Promise<void> {
    const now = params.now ?? new Date();
    const { monthMarker } = monthBounds(now);
    const id = bucketId(params.userId, params.surface, monthMarker);
    await this.buckets.updateOne(
      { _id: id, used: { $gt: 0 } },
      { $inc: { used: -1 }, $set: { updatedAt: now } },
    );
  }

  /**
   * Atomically increase the admin-grant counter for the bucket. Upsert
   * on first touch.
   */
  async incrementAdminGrant(params: UpsertGrantParams): Promise<QuotaBucketDoc> {
    const now = params.now ?? new Date();
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const id = bucketId(params.userId, params.surface, monthMarker);
    const result = await this.buckets.findOneAndUpdate(
      { _id: id },
      {
        $inc: { adminGrant: params.amount },
        $set: { updatedAt: now },
        $setOnInsert: {
          userId: params.userId,
          surface: params.surface,
          monthMarker,
          monthStart,
          monthEnd,
          defaultAllotment: params.defaultAllotment,
          used: 0,
          usedByModel: {},
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new Error(`incrementAdminGrant: upsert returned null for ${id}`);
    }
    return result;
  }

  async appendGrantAudit(row: Omit<QuotaGrantAuditDoc, "_id">): Promise<string> {
    const _id = randomUUID();
    await this.audit.insertOne({ _id, ...row });
    logger.info(
      {
        adminUserId: row.adminUserId,
        targetUserId: row.targetUserId,
        surface: row.surface,
        amount: row.amount,
        monthMarker: row.monthMarker,
      },
      "Quota grant audit appended",
    );
    return _id;
  }

  async listGrantAudit(params: {
    page: number;
    pageSize: number;
    targetUserId?: string;
    adminUserId?: string;
  }): Promise<{ items: QuotaGrantAuditDoc[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.targetUserId) filter.targetUserId = params.targetUserId;
    if (params.adminUserId) filter.adminUserId = params.adminUserId;
    const total = await this.audit.countDocuments(filter);
    const offset = (params.page - 1) * params.pageSize;
    const items = await this.audit
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(params.pageSize)
      .toArray();
    return { items, total };
  }
}
