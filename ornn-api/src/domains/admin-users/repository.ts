/**
 * Admin-users repository.
 *
 * Tracks every NyxID user we've seen carrying the `ornn:admin:skill`
 * permission on Ornn. Populated lazily on every authenticated request
 * (the proxy auth setup layer fires `upsert` when it sees the perm),
 * read by admin-facing list endpoints (e.g. `/admin/quota/users`) so
 * the UI can render an "Unlimited" stamp on those rows.
 *
 * NyxID is still the source of truth on the hot path — every admin
 * action goes through `requirePermission("ornn:admin:skill")`. This
 * collection is a *display cache*, not an authorization layer.
 *
 * @module domains/admin-users/repository
 */

import type { Db } from "mongodb";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "adminUsersRepository" });

const COLLECTION = "admin_users";

export interface AdminUserDoc {
  /** NyxID userId — primary key. */
  _id: string;
  email: string;
  displayName: string;
  /** First time we saw this user authenticate as an admin. */
  firstSeenAt: Date;
  /** Most recent time we saw the admin permission for this user. */
  lastSeenAt: Date;
}

export class AdminUsersRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    await this.db.collection<AdminUserDoc>(COLLECTION).createIndex({ email: 1 });
  }

  /**
   * Upsert a row for `user`, refreshing `lastSeenAt`. Fire-and-forget
   * caller — never block the request path on a failed upsert.
   */
  async upsert(user: { userId: string; email: string; displayName: string }): Promise<void> {
    const now = new Date();
    try {
      await this.db.collection<AdminUserDoc>(COLLECTION).updateOne(
        { _id: user.userId },
        {
          $set: {
            email: user.email,
            displayName: user.displayName,
            lastSeenAt: now,
          },
          $setOnInsert: {
            _id: user.userId,
            firstSeenAt: now,
          },
        },
        { upsert: true },
      );
    } catch (err) {
      logger.warn({ err, userId: user.userId }, "Failed to upsert admin-user record");
    }
  }

  /** Set of userIds known to carry the admin permission. */
  async listUserIds(): Promise<Set<string>> {
    const rows = await this.db
      .collection<AdminUserDoc>(COLLECTION)
      .find({}, { projection: { _id: 1 } })
      .toArray();
    return new Set(rows.map((r) => r._id));
  }

  async list(): Promise<AdminUserDoc[]> {
    return this.db.collection<AdminUserDoc>(COLLECTION).find().toArray();
  }
}
