/**
 * Mongo persistence for per-user quota counters and admin grant audit.
 *
 *   `user_quotas`  — one document per user, keyed by `userId`. Counters
 *                    + credit balances per surface.
 *   `quota_grants` — append-only audit trail for every grant operation.
 *
 * Counters are zeroed lazily on read+charge against the live UTC marker
 * (see `types.ts`). No cron is required.
 *
 * @module domains/quota/repository
 */

import type { Collection, Db } from "mongodb";
import { randomUUID } from "node:crypto";
import pino from "pino";
import {
  type QuotaGrantAudit,
  type Surface,
  type SurfaceCounter,
  type UserQuotaDocument,
  currentDailyMarker,
  currentMonthlyMarker,
  freshSurfaceCounter,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "quotaRepository" });

/**
 * Apply lazy resets to a counter against the current markers. Returns
 * the (possibly-zeroed) counter and a boolean indicating whether any
 * reset actually happened — callers can use that to decide whether to
 * persist the change immediately or piggyback it on the next charge.
 */
export function applyResets(
  counter: SurfaceCounter,
  now: Date = new Date(),
): { counter: SurfaceCounter; reset: boolean } {
  const monthly = currentMonthlyMarker(now);
  const daily = currentDailyMarker(now);
  let monthlyUsed = counter.monthlyUsed;
  let dailyUsed = counter.dailyUsed;
  let reset = false;
  if (counter.monthlyResetMarker !== monthly) {
    monthlyUsed = 0;
    reset = true;
  }
  if (counter.dailyResetMarker !== daily) {
    dailyUsed = 0;
    reset = true;
  }
  return {
    counter: {
      monthlyUsed,
      dailyUsed,
      creditsBalance: counter.creditsBalance,
      monthlyResetMarker: monthly,
      dailyResetMarker: daily,
    },
    reset,
  };
}

export class QuotaRepository {
  private readonly quotas: Collection<UserQuotaDocument>;
  private readonly grants: Collection<QuotaGrantAudit>;

  constructor(db: Db) {
    this.quotas = db.collection<UserQuotaDocument>("user_quotas");
    this.grants = db.collection<QuotaGrantAudit>("quota_grants");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.quotas.createIndex({ userId: 1 }, { unique: true });
      await this.grants.createIndex({ targetUserId: 1, createdAt: -1 });
      await this.grants.createIndex({ adminUserId: 1, createdAt: -1 });
      await this.grants.createIndex({ createdAt: -1 });
      // Active-grants index — covers `sumActiveCredits` and
      // `tryConsumeActiveGrant`. Sparse on `expiresAt` so non-expiring
      // grants index without a fake date sentinel.
      await this.grants.createIndex(
        { targetUserId: 1, surface: 1, expiresAt: 1, createdAt: 1 },
        { name: "active_grants_lookup" },
      );
    } catch (err) {
      logger.warn({ err }, "quota indexes ensureIndexes failed — proceeding anyway");
    }
  }

  /**
   * Fetch a user's quota document, lazily zeroing windows whose markers
   * have rolled over. Always returns a non-null document — a fresh one
   * is materialized in memory (and persisted) for first-time callers.
   */
  async getOrInit(userId: string, now: Date = new Date()): Promise<UserQuotaDocument> {
    const doc = await this.quotas.findOne({ userId });
    if (!doc) {
      const fresh: UserQuotaDocument = {
        userId,
        playground: freshSurfaceCounter(now),
        skillGen: freshSurfaceCounter(now),
        updatedAt: now,
      };
      await this.quotas
        .updateOne({ userId }, { $setOnInsert: fresh }, { upsert: true })
        .catch((err) => logger.warn({ err, userId }, "quota init upsert failed"));
      return fresh;
    }
    const playground = applyResets(doc.playground, now);
    const skillGen = applyResets(doc.skillGen, now);
    if (playground.reset || skillGen.reset) {
      await this.quotas
        .updateOne(
          { userId },
          {
            $set: {
              playground: playground.counter,
              skillGen: skillGen.counter,
              updatedAt: now,
            },
          },
        )
        .catch((err) => logger.warn({ err, userId }, "quota reset persist failed"));
    }
    return {
      userId,
      playground: playground.counter,
      skillGen: skillGen.counter,
      updatedAt: doc.updatedAt ?? now,
    };
  }

  /**
   * Increment a surface's `monthlyUsed` and `dailyUsed` by 1. The
   * service layer is responsible for separately consuming a credit
   * (legacy bucket OR active grant ledger) when the monthly base is
   * exhausted — see `tryDecrementLegacyCredits` and
   * `tryConsumeActiveGrant`.
   */
  async chargeMonthly(params: {
    userId: string;
    surface: Surface;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    const surface = params.surface;
    const monthly = currentMonthlyMarker(now);
    const daily = currentDailyMarker(now);

    await this.quotas.updateOne(
      { userId: params.userId },
      {
        $inc: {
          [`${surface}.monthlyUsed`]: 1,
          [`${surface}.dailyUsed`]: 1,
        },
        $set: {
          [`${surface}.monthlyResetMarker`]: monthly,
          [`${surface}.dailyResetMarker`]: daily,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
  }

  /**
   * Atomically decrement `creditsBalance` (legacy non-expiring bucket)
   * if positive. Returns true on success, false when no legacy balance
   * was available — caller should fall through to the grant ledger.
   */
  async tryDecrementLegacyCredits(params: {
    userId: string;
    surface: Surface;
    now?: Date;
  }): Promise<boolean> {
    const now = params.now ?? new Date();
    const r = await this.quotas.updateOne(
      {
        userId: params.userId,
        [`${params.surface}.creditsBalance`]: { $gt: 0 },
      },
      {
        $inc: { [`${params.surface}.creditsBalance`]: -1 },
        $set: { updatedAt: now },
      },
    );
    return r.modifiedCount === 1;
  }

  /**
   * Find the oldest active grant (consumed < amount AND not expired)
   * for the user/surface and increment its `consumed` by 1. Atomic
   * findOneAndUpdate so two parallel charges can't double-spend the
   * same row's last credit.
   *
   * Returns true on success, false when no active grant has capacity.
   */
  async tryConsumeActiveGrant(params: {
    userId: string;
    surface: Surface;
    now?: Date;
  }): Promise<boolean> {
    const now = params.now ?? new Date();
    const r = await this.grants.findOneAndUpdate(
      {
        targetUserId: params.userId,
        surface: params.surface,
        $expr: { $lt: ["$consumed", "$amount"] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { $inc: { consumed: 1 } },
      // Sort oldest first so admins can predict expiry-vs-consumption
      // ordering ("the credits I gave you 6 months ago drain first").
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    return r !== null;
  }

  /**
   * Sum `(amount - consumed)` over all active grants for the user/
   * surface. Active = not yet drained AND not yet expired.
   */
  async sumActiveCredits(
    userId: string,
    surface: Surface,
    now: Date = new Date(),
  ): Promise<number> {
    const cursor = this.grants.aggregate<{ total: number }>([
      {
        $match: {
          targetUserId: userId,
          surface,
          $expr: { $lt: ["$consumed", "$amount"] },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        },
      },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $subtract: [
                "$amount",
                { $ifNull: ["$consumed", 0] },
              ],
            },
          },
        },
      },
    ]);
    const rows = await cursor.toArray();
    return rows[0]?.total ?? 0;
  }

  /**
   * Insert a grant row. The grant is the only source of truth for
   * credits — `creditsBalance` on the user counter doc is legacy and
   * never written here. `expiresAt: null` = never expires.
   *
   * Returns the new grant `_id`.
   */
  async recordGrant(params: {
    adminUserId: string;
    adminEmail: string;
    adminDisplayName: string;
    targetUserId: string;
    surface: Surface;
    amount: number;
    expiresAt: Date | null;
    note?: string;
    now?: Date;
  }): Promise<string> {
    const now = params.now ?? new Date();
    const id = randomUUID();
    const row: QuotaGrantAudit = {
      _id: id,
      adminUserId: params.adminUserId,
      adminEmail: params.adminEmail,
      adminDisplayName: params.adminDisplayName,
      targetUserId: params.targetUserId,
      surface: params.surface,
      amount: params.amount,
      consumed: 0,
      expiresAt: params.expiresAt,
      createdAt: now,
      ...(params.note ? { note: params.note } : {}),
    };
    await this.grants.insertOne(row);
    logger.info(
      {
        adminUserId: params.adminUserId,
        targetUserId: params.targetUserId,
        surface: params.surface,
        amount: params.amount,
        expiresAt: params.expiresAt,
      },
      "Quota grant recorded (active credits ledger)",
    );
    return id;
  }

  async listGrants(params: {
    page: number;
    pageSize: number;
    targetUserId?: string;
    adminUserId?: string;
  }): Promise<{ items: QuotaGrantAudit[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.targetUserId) filter.targetUserId = params.targetUserId;
    if (params.adminUserId) filter.adminUserId = params.adminUserId;
    const total = await this.grants.countDocuments(filter);
    const offset = (params.page - 1) * params.pageSize;
    const items = await this.grants
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(params.pageSize)
      .toArray();
    return { items, total };
  }
}

function otherSurface(s: Surface): Surface {
  return s === "playground" ? "skillGen" : "playground";
}
