/**
 * User directory — single identity cache for everyone Ornn has seen
 * authenticate. Backs the skill-permissions typeahead, the admin user
 * lists (admin + normal partition), the dashboard user totals, and any
 * userId → email/displayName lookup that doesn't want to go round-trip
 * NyxID on the request hot path.
 *
 * NyxID is the source of truth for identity and permissions. This
 * collection is a *display + indexing cache*, never an authorization
 * layer. `isAdmin` here reflects the most-recent observation of
 * `ornn:admin:skill` on a request — fine for "show this user as admin
 * in lists" but never for permission gating.
 *
 * Replaces the old activity-derived directory (the `activities`
 * collection in `domains/admin/activityRepository.ts` doubled as audit
 * log + directory) and consolidates `admin_users` + `users_meta` into
 * one place. Audit logging itself moved to PostHog (issue #271).
 *
 * Lifecycle:
 *   - `upsert` is fire-and-forget from the proxy-auth setup middleware
 *     on every authenticated request. Sets `firstSeenAt` once,
 *     refreshes `lastSeenAt`, increments `activityCount`, and updates
 *     `email` / `displayName` / `isAdmin` on each call.
 *   - `firstSeenAt` is the first time Ornn saw the user post-migration
 *     to this collection. Existing users' "true" first-join date is
 *     not backfilled — a known accepted regression for display-only
 *     fields (issue #271 changeset).
 *
 * @module domains/users/repository
 */

import type { Collection, Db } from "mongodb";
import { createLogger } from "../../shared/logger";
const logger = createLogger("userDirectoryRepository");

const COLLECTION = "users";

export interface UserDirectoryDoc {
  /** NyxID userId — primary key. */
  _id: string;
  email: string;
  displayName: string;
  /** First time Ornn saw this user. Never updated after insert. */
  firstSeenAt: Date;
  /** Most recent authenticated request from this user. */
  lastSeenAt: Date;
  /**
   * Lifetime count of authenticated requests Ornn has seen from this
   * user. Bumped on every upsert. Display-only — replaces the old
   * `activityCount` column that was derived from the `activities`
   * collection.
   */
  activityCount: number;
  /**
   * Most-recent observation of the `ornn:admin:skill` permission on
   * this user. Display-only; NyxID is authoritative for actual
   * permission checks (every admin route still calls
   * `requirePermission`).
   */
  isAdmin: boolean;
}

export type Role = "admin" | "normal";

export type UserSortKey =
  | "displayName"
  | "email"
  | "lastSeenAt"
  | "activityCount"
  | "firstSeenAt";

export type UserSortDir = "asc" | "desc";

export interface ListUsersParams {
  role: Role;
  page: number;
  pageSize: number;
  /** Email-prefix substring (case-insensitive). Empty = no filter. */
  q?: string;
  sort?: UserSortKey;
  dir?: UserSortDir;
}

export interface UserDirectoryEntry {
  userId: string;
  email: string;
  displayName: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  activityCount: number;
  isAdmin: boolean;
}

export class UserDirectoryRepository {
  private readonly collection: Collection<UserDirectoryDoc>;

  constructor(db: Db) {
    this.collection = db.collection<UserDirectoryDoc>(COLLECTION);
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex({ email: 1 }),
        this.collection.createIndex({ isAdmin: 1 }),
        this.collection.createIndex({ lastSeenAt: -1 }),
      ]);
    } catch (err) {
      logger.warn({ err }, "users indexes ensureIndexes failed — proceeding anyway");
    }
  }

  /**
   * Lazy upsert called from proxy-auth setup on every authenticated
   * request. Fire-and-forget — never blocks the request hot path; on
   * Mongo failure we log and move on.
   */
  async upsert(user: {
    userId: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  }): Promise<void> {
    const now = new Date();
    try {
      // `activityCount` is bumped via `$inc` on every call. On insert
      // Mongo treats a missing field as 0, so we don't need to seed it
      // in `$setOnInsert` — and including it there creates a path
      // conflict ("Updating the path 'activityCount' would create a
      // conflict at 'activityCount'").
      await this.collection.updateOne(
        { _id: user.userId },
        {
          $set: {
            email: user.email,
            displayName: user.displayName,
            isAdmin: user.isAdmin,
            lastSeenAt: now,
          },
          $setOnInsert: {
            _id: user.userId,
            firstSeenAt: now,
          },
          $inc: { activityCount: 1 },
        },
        { upsert: true },
      );
    } catch (err) {
      logger.warn({ err, userId: user.userId }, "user directory upsert failed");
    }
  }

  /** Set of userIds with the most-recent observation of admin permission. */
  async listAdminUserIds(): Promise<Set<string>> {
    const rows = await this.collection
      .find({ isAdmin: true }, { projection: { _id: 1 } })
      .toArray();
    return new Set(rows.map((r) => r._id));
  }

  /** All admin-flagged users (full doc). Display-only. */
  async listAdmins(): Promise<UserDirectoryDoc[]> {
    return this.collection.find({ isAdmin: true }).toArray();
  }

  /**
   * Email-prefix typeahead. Backs the skill-permissions panel
   * collaborator picker — anyone with an account can resolve email →
   * userId via this endpoint, no admin gate.
   *
   * Empty `prefix` returns the full pool (top-N by recency) so the
   * picker can render an on-focus list without having to type first.
   */
  async searchByEmailPrefix(
    prefix: string,
    limit: number,
  ): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    const trimmed = prefix.trim();
    const filter: Record<string, unknown> = trimmed
      ? {
          email: {
            $regex: `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
            $options: "i",
          },
        }
      : { email: { $ne: "" } };

    const rows = await this.collection
      .find(filter)
      .sort({ lastSeenAt: -1 })
      .limit(limit)
      .toArray();

    return rows.map((r) => ({
      userId: r._id,
      email: r.email,
      displayName: r.displayName,
    }));
  }

  /**
   * Batch resolve a list of userIds to their last-known email +
   * displayName. Order is not guaranteed; callers build their own
   * keyed map if positional ordering matters. Unknown ids are silently
   * dropped.
   */
  async findByUserIds(
    ids: readonly string[],
  ): Promise<
    Array<{
      userId: string;
      email: string;
      displayName: string;
    }>
  > {
    if (ids.length === 0) return [];
    const rows = await this.collection
      .find({ _id: { $in: [...ids] } })
      .toArray();
    return rows.map((r) => ({
      userId: r._id,
      email: r.email,
      displayName: r.displayName,
    }));
  }

  /**
   * Paginated user list with role filter (admin vs normal), email
   * prefix search, and sort. Replaces the old activity-derived
   * `aggregateUsers` pipeline. Skill counts are NOT joined here —
   * callers enrich with their own `skills` collection lookup.
   */
  async listUsers(params: ListUsersParams): Promise<{
    items: UserDirectoryEntry[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(200, Math.max(1, params.pageSize));
    const sortKey: UserSortKey = params.sort ?? "lastSeenAt";
    const dir: UserSortDir = params.dir ?? "desc";

    const filter: Record<string, unknown> = {
      isAdmin: params.role === "admin",
      ...buildUserSearchFilter(params.q),
    };

    const total = await this.collection.countDocuments(filter);
    const sortSpec: Record<string, 1 | -1> = {
      [sortKey]: dir === "asc" ? 1 : -1,
    };

    const rows = await this.collection
      .find(filter)
      .sort(sortSpec)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray();

    const items = rows.map(toEntry);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Unbounded list within a role + email-prefix filter. Used by the
   * admin user-list service which needs to sort by skill-count
   * (requires a join + global sort) before paginating in memory.
   * Bounded by an explicit `hardLimit` to keep memory predictable.
   */
  async findAllInRole(
    role: Role,
    q: string | undefined,
    hardLimit = 5000,
  ): Promise<UserDirectoryDoc[]> {
    const filter: Record<string, unknown> = {
      isAdmin: role === "admin",
      ...buildUserSearchFilter(q),
    };
    return this.collection.find(filter).limit(hardLimit).toArray();
  }

  /**
   * Tile counts for the admin dashboard. Replaces the activity-derived
   * `getStats` from the old ActivityRepository.
   */
  async countByRole(): Promise<{ admin: number; normal: number; total: number }> {
    const [admin, total] = await Promise.all([
      this.collection.countDocuments({ isAdmin: true }),
      this.collection.countDocuments({}),
    ]);
    return { admin, normal: Math.max(0, total - admin), total };
  }
}

/**
 * Build a Mongo filter fragment for the admin user-list search box.
 *
 * #587 — the box's placeholder says "email or display name" but the
 * server only matched on email-prefix. Display names + substring
 * keywords were silently ignored. Fix is additive:
 *
 *   - **Email** — keep the anchored prefix regex (it's the historical
 *     behaviour, indexable, and matches the "type the local part" UX
 *     admins already rely on).
 *   - **DisplayName** — add a case-insensitive *substring* match.
 *     Display names don't have a meaningful prefix (`Ornn Local Proxy`
 *     should hit on `Proxy`, not just `Ornn`).
 *
 * `$or` lets either match. Empty / whitespace queries return an empty
 * fragment so the role filter alone drives the query.
 *
 * Regex meta-chars are escaped so a literal `.` / `*` in a display name
 * or local-part doesn't blow up the query (or DoS the matcher).
 */
function buildUserSearchFilter(q: string | undefined): Record<string, unknown> {
  const trimmed = q?.trim();
  if (!trimmed) return {};
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    $or: [
      { email: { $regex: `^${escaped}`, $options: "i" } },
      { displayName: { $regex: escaped, $options: "i" } },
    ],
  };
}

function toEntry(doc: UserDirectoryDoc): UserDirectoryEntry {
  return {
    userId: doc._id,
    email: doc.email,
    displayName: doc.displayName,
    firstSeenAt: doc.firstSeenAt instanceof Date ? doc.firstSeenAt.toISOString() : null,
    lastSeenAt: doc.lastSeenAt instanceof Date ? doc.lastSeenAt.toISOString() : null,
    activityCount: doc.activityCount ?? 0,
    isAdmin: !!doc.isAdmin,
  };
}
