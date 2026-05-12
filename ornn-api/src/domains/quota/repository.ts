/**
 * Mongo persistence for the calendar-month quota bucket model.
 *
 *   `quota_buckets`        — one document per (userId, surface,
 *                            monthMarker). Atomic `$inc` on `used` /
 *                            `usedByModel` / `adminGrant`.
 *   `quota_grants_audit`   — append-only history of admin grants
 *                            (replaces the old drainable ledger).
 *
 * @module domains/quota/repository
 */

import type { Collection, Db } from "mongodb";
import { randomUUID } from "node:crypto";
import pino from "pino";
import {
  type QuotaBucketDoc,
  type QuotaGrantAuditDoc,
  type Surface,
  bucketId,
  escapeModelKey,
  monthBounds,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "quotaRepository" });

export interface UpsertChargeParams {
  userId: string;
  surface: Surface;
  modelId: string | null | undefined;
  defaultAllotment: number;
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
   * Atomically increment `used` and `usedByModel.<id>`. Upserts a fresh
   * bucket on first touch with the spec defaults — `$setOnInsert` keeps
   * existing buckets untouched. Returns the after-state for callers
   * who want to log resulting counters.
   */
  async incrementUsed(params: UpsertChargeParams): Promise<QuotaBucketDoc> {
    const now = params.now ?? new Date();
    const { monthMarker, monthStart, monthEnd } = monthBounds(now);
    const id = bucketId(params.userId, params.surface, monthMarker);
    const modelKey = escapeModelKey(params.modelId);

    const result = await this.buckets.findOneAndUpdate(
      { _id: id },
      {
        $inc: { used: 1, [`usedByModel.${modelKey}`]: 1 },
        $set: { updatedAt: now },
        $setOnInsert: {
          userId: params.userId,
          surface: params.surface,
          monthMarker,
          monthStart,
          monthEnd,
          defaultAllotment: params.defaultAllotment,
          adminGrant: 0,
          createdAt: now,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!result) {
      throw new Error(`incrementUsed: upsert returned null for ${id}`);
    }
    return result;
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
