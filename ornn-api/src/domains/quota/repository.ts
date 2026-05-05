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
   * Atomically increment a surface's `monthlyUsed` and `dailyUsed` by 1
   * and (when monthly base is exhausted) decrement `creditsBalance`.
   * Caller passes the already-decided `decrementCredit` flag so the
   * service layer owns the deduction-order policy.
   */
  async charge(params: {
    userId: string;
    surface: Surface;
    decrementCredit: boolean;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    const surface = params.surface;
    const monthly = currentMonthlyMarker(now);
    const daily = currentDailyMarker(now);

    const inc: Record<string, number> = {
      [`${surface}.monthlyUsed`]: 1,
      [`${surface}.dailyUsed`]: 1,
    };
    if (params.decrementCredit) {
      inc[`${surface}.creditsBalance`] = -1;
    }

    await this.quotas.updateOne(
      { userId: params.userId },
      {
        $inc: inc,
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
   * Add `amount` credits to a user's surface bucket. Atomic. Used by
   * both the per-user grant route and bulk grant route.
   */
  async addCredits(params: {
    userId: string;
    surface: Surface;
    amount: number;
    now?: Date;
  }): Promise<void> {
    const now = params.now ?? new Date();
    const monthly = currentMonthlyMarker(now);
    const daily = currentDailyMarker(now);
    const other = otherSurface(params.surface);
    await this.quotas.updateOne(
      { userId: params.userId },
      {
        $inc: { [`${params.surface}.creditsBalance`]: params.amount },
        $set: { updatedAt: now },
        $setOnInsert: {
          userId: params.userId,
          [other]: freshSurfaceCounter(now),
          [`${params.surface}.monthlyUsed`]: 0,
          [`${params.surface}.dailyUsed`]: 0,
          [`${params.surface}.monthlyResetMarker`]: monthly,
          [`${params.surface}.dailyResetMarker`]: daily,
        },
      },
      { upsert: true },
    );
  }

  async logGrant(params: {
    adminUserId: string;
    adminEmail: string;
    adminDisplayName: string;
    targetUserId: string;
    surface: Surface;
    amount: number;
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
      },
      "Quota grant logged",
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
