/**
 * Mongo persistence for redemption codes.
 *
 *   `redemption_codes` — one document per minted code. Lifecycle:
 *     active → redeemed   (via `tryClaimForRedeem`)
 *     active → invalidated (via `tryInvalidate`)
 *
 * Both transitions are atomic `findOneAndUpdate` pivots so concurrent
 * redeems / invalidates of the same code produce exactly one winner.
 *
 * @module domains/redemption-codes/repository
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";
import {
  type ActorMeta,
  type RedemptionCodeDoc,
  type RedemptionCodeStatus,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "redemptionCodeRepository" });

/**
 * Escape a user-supplied string before embedding in a `$regex`. Same
 * trick as `String.raw.replace`-based escapers — covers the standard
 * regex meta chars MongoDB recognises.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class RedemptionCodeRepository {
  private readonly codes: Collection<RedemptionCodeDoc>;

  constructor(db: Db) {
    this.codes = db.collection<RedemptionCodeDoc>("redemption_codes");
  }

  get collection(): Collection<RedemptionCodeDoc> {
    return this.codes;
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.codes.createIndex({ code: 1 }, { unique: true, name: "code_unique" });
      await this.codes.createIndex(
        { status: 1, createdAt: -1 },
        { name: "status_recent" },
      );
      await this.codes.createIndex(
        { "redeemedBy.userId": 1, redeemedAt: -1 },
        { name: "redeemed_by_user" },
      );
      await this.codes.createIndex(
        { "createdBy.userId": 1, createdAt: -1 },
        { name: "created_by_admin" },
      );
    } catch (err) {
      logger.warn({ err }, "redemption_codes ensureIndexes failed — proceeding anyway");
    }
  }

  async insertCode(doc: RedemptionCodeDoc): Promise<void> {
    await this.codes.insertOne(doc);
  }

  async findByCode(code: string): Promise<RedemptionCodeDoc | null> {
    return this.codes.findOne({ code });
  }

  async findById(id: string): Promise<RedemptionCodeDoc | null> {
    return this.codes.findOne({ _id: id });
  }

  /**
   * Atomic `active → redeemed` pivot. The filter requires `status:
   * "active"` AND `expiresAt > now`, so an expired or already-claimed
   * code yields null even on the same millisecond. Returns the post-
   * update doc on success, null otherwise.
   */
  async tryClaimForRedeem(params: {
    code: string;
    redeemedBy: ActorMeta;
    now: Date;
  }): Promise<RedemptionCodeDoc | null> {
    const result = await this.codes.findOneAndUpdate(
      { code: params.code, status: "active", expiresAt: { $gt: params.now } },
      {
        $set: {
          status: "redeemed",
          redeemedAt: params.now,
          redeemedBy: params.redeemedBy,
        },
      },
      { returnDocument: "after" },
    );
    return result ?? null;
  }

  /**
   * Atomic `active → invalidated` pivot. Returns the post-update doc
   * on success, null when the code isn't active anymore.
   */
  async tryInvalidate(params: {
    id: string;
    invalidatedBy: ActorMeta;
    now: Date;
  }): Promise<RedemptionCodeDoc | null> {
    const result = await this.codes.findOneAndUpdate(
      { _id: params.id, status: "active" },
      {
        $set: {
          status: "invalidated",
          invalidatedAt: params.now,
          invalidatedBy: params.invalidatedBy,
        },
      },
      { returnDocument: "after" },
    );
    return result ?? null;
  }

  async list(params: {
    page: number;
    pageSize: number;
    status?: RedemptionCodeStatus;
    search?: string;
  }): Promise<{ items: RedemptionCodeDoc[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.status) filter.status = params.status;
    const search = params.search?.trim();
    if (search) {
      const escaped = escapeRegex(search);
      filter.$or = [
        { code: { $regex: `^${escapeRegex(search.toUpperCase())}` } },
        { note: { $regex: escaped, $options: "i" } },
      ];
    }
    const total = await this.codes.countDocuments(filter);
    const offset = (params.page - 1) * params.pageSize;
    const items = await this.codes
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(params.pageSize)
      .toArray();
    return { items, total };
  }

  async listRedeemedByUser(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: RedemptionCodeDoc[]; total: number }> {
    const filter = { "redeemedBy.userId": userId };
    const total = await this.codes.countDocuments(filter);
    const offset = (page - 1) * pageSize;
    const items = await this.codes
      .find(filter)
      .sort({ redeemedAt: -1 })
      .skip(offset)
      .limit(pageSize)
      .toArray();
    return { items, total };
  }
}
