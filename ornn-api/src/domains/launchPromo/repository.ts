/**
 * Launch-promo claims repository (#724).
 *
 * Wraps the single `launch_promo_claims` collection. A claim doc is
 * the source-of-truth for "this Ornn user has been awarded the launch
 * promo grant" — its presence alone is the idempotency gate; we never
 * mint twice for the same user.
 *
 * @module domains/launchPromo/repository
 */

import type { Collection, Db } from "mongodb";
import { createLogger } from "../../shared/logger";
import type { LaunchPromoClaimDoc } from "./types";

const logger = createLogger("launchPromoRepository");

export class LaunchPromoRepository {
  private readonly collection: Collection<LaunchPromoClaimDoc>;

  constructor(db: Db) {
    this.collection = db.collection<LaunchPromoClaimDoc>("launch_promo_claims");
  }

  async ensureIndexes(): Promise<void> {
    // `_id` is auto-indexed; the second index sorts the admin overview
    // by award order without paying for a doc scan.
    await this.collection.createIndex(
      { awardedAt: -1 },
      { name: "launch_promo_awardedAt_desc" },
    );
  }

  /** Has this user already been awarded? Primary-key lookup. */
  async hasClaimed(userId: string): Promise<boolean> {
    const doc = await this.collection.findOne(
      { _id: userId },
      { projection: { _id: 1 } },
    );
    return !!doc;
  }

  /** Read the full claim doc (or null if no claim). */
  async findByUserId(userId: string): Promise<LaunchPromoClaimDoc | null> {
    return this.collection.findOne({ _id: userId });
  }

  /**
   * Insert a claim row. Throws on duplicate-key (caller treats that
   * as "someone else's race won" and skips).
   */
  async insert(doc: LaunchPromoClaimDoc): Promise<void> {
    try {
      await this.collection.insertOne(doc);
      logger.info(
        {
          userId: doc._id,
          rank: doc.eligibilityRank,
          redemptionCodeId: doc.redemptionCodeId,
          awardedBy: doc.awardedBy,
        },
        "Launch-promo claim recorded",
      );
    } catch (err) {
      // Duplicate-key error code is 11000. Bubble up so the service
      // can short-circuit cleanly.
      throw err;
    }
  }

  /** Count of awarded claims — the slot-utilisation gate. */
  async countAwarded(): Promise<number> {
    return this.collection.countDocuments({});
  }

  /** Most-recent claims, for admin observability. */
  async listRecent(limit: number): Promise<LaunchPromoClaimDoc[]> {
    return this.collection
      .find({})
      .sort({ awardedAt: -1 })
      .limit(Math.max(1, Math.min(limit, 500)))
      .toArray();
  }
}
