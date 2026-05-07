/**
 * UsersMeta cache. `firstJoinedAt` is synthesized from
 * `MIN(activities.createdAt)` per userId because NyxID does not expose
 * a join date. The cached row also stores `email` + `displayName` from
 * the most recent activity row so the admin user-list endpoint doesn't
 * have to re-aggregate per page.
 *
 * Architecture §3.5; resolves Q4.
 *
 * @module domains/admin-users/usersMetaRepository
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "usersMetaRepository" });

const COLLECTION = "users_meta";

export interface UserMetaDoc {
  _id: string;
  firstJoinedAt: Date | null;
  computedAt: Date;
  email: string;
  displayName: string;
}

export class UsersMetaRepository {
  private readonly meta: Collection<UserMetaDoc>;
  private readonly activities: Collection;

  constructor(private readonly db: Db) {
    this.meta = db.collection<UserMetaDoc>(COLLECTION);
    this.activities = db.collection("activities");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.meta.createIndex({ email: 1 });
    } catch (err) {
      logger.warn({ err }, "users_meta indexes ensureIndexes failed — proceeding anyway");
    }
  }

  /**
   * Return the cached row, or compute + persist + return one if missing.
   * `computedAt` lets a caller decide to recompute later (TTL); we do
   * not refresh on read here — the cached row is authoritative until
   * explicitly invalidated or re-seeded by the migration script.
   */
  async getOrCompute(userId: string): Promise<UserMetaDoc> {
    const existing = await this.meta.findOne({ _id: userId });
    if (existing) return existing;
    return this.compute(userId);
  }

  /** Compute (or recompute) and persist a row for `userId`. */
  async compute(userId: string): Promise<UserMetaDoc> {
    const cursor = this.activities.aggregate([
      { $match: { userId } },
      { $sort: { createdAt: 1 as const } },
      {
        $group: {
          _id: "$userId",
          firstJoinedAt: { $min: "$createdAt" },
          email: { $last: "$userEmail" },
          displayName: { $last: "$userDisplayName" },
        },
      },
    ]);
    const rows = await cursor.toArray();
    const row = rows[0];
    const doc: UserMetaDoc = {
      _id: userId,
      firstJoinedAt:
        row?.firstJoinedAt instanceof Date
          ? (row.firstJoinedAt as Date)
          : row?.firstJoinedAt
            ? new Date(row.firstJoinedAt as string)
            : null,
      computedAt: new Date(),
      email: (row?.email as string) ?? "",
      displayName: (row?.displayName as string) ?? "",
    };
    await this.meta.updateOne(
      { _id: userId },
      { $set: doc },
      { upsert: true },
    );
    return doc;
  }

  /** Bulk getOrCompute for a page of userIds. Order matches input. */
  async batchGetOrCompute(userIds: readonly string[]): Promise<UserMetaDoc[]> {
    if (userIds.length === 0) return [];
    const existing = await this.meta.find({ _id: { $in: [...userIds] } }).toArray();
    const byId = new Map(existing.map((r) => [r._id, r]));
    const out: UserMetaDoc[] = [];
    for (const id of userIds) {
      const cached = byId.get(id);
      if (cached) {
        out.push(cached);
      } else {
        out.push(await this.compute(id));
      }
    }
    return out;
  }

  /** Manual seed — used by the migration script + tests. */
  async upsert(doc: UserMetaDoc): Promise<void> {
    await this.meta.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
  }
}
