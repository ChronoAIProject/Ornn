/**
 * AdminUsersService — paginated admin/normal user lists with the six
 * columns specified in Story 4.1/4.2:
 *   `displayName`, `email`, `skillCount`, `lastActiveAt`,
 *   `activityCount`, `firstJoinedAt`.
 *
 * After issue #271:
 *   - Source pool is the unified `users` directory (fed lazily by the
 *     proxy-auth setup middleware on every authenticated request).
 *   - Skill counts come from the `skills` collection.
 *   - `firstJoinedAt` ↔ `firstSeenAt`, `lastActiveAt` ↔ `lastSeenAt`
 *     in the underlying directory doc — API names are preserved so
 *     the existing admin frontend doesn't need to change.
 *   - `activityCount` semantics shifted from "rows in activities
 *     table" to "authenticated requests seen" (incremented on every
 *     directory upsert). Higher numbers are expected; still
 *     monotonic.
 *
 * Sort by `skillCount` is implemented JS-side because it requires a
 * cross-collection join. Hard-bounded to 5k users in role+q to keep
 * memory predictable; beyond that we'd switch to Mongo aggregation.
 *
 * @module domains/admin-users/service
 */

import type { Collection, Db } from "mongodb";
import { createLogger } from "../../shared/logger";
import type { UserDirectoryRepository } from "../users/repository";

const logger = createLogger("adminUsersService");

export type Role = "admin" | "normal";

export type SortKey =
  | "displayName"
  | "email"
  | "skillCount"
  | "lastActiveAt"
  | "activityCount"
  | "firstJoinedAt";

export type SortDir = "asc" | "desc";

export interface ListUsersParams {
  role: Role;
  page: number;
  pageSize: number;
  q?: string;
  sort?: SortKey;
  dir?: SortDir;
}

export interface AdminUserRow {
  userId: string;
  email: string;
  displayName: string;
  skillCount: number;
  lastActiveAt: string | null;
  activityCount: number;
  firstJoinedAt: string | null;
}

export interface AdminUsersServiceConfig {
  db: Db;
  userDirectoryRepo: UserDirectoryRepository;
}

export class AdminUsersService {
  private readonly skills: Collection;
  private readonly userDirectoryRepo: UserDirectoryRepository;

  constructor(config: AdminUsersServiceConfig) {
    this.skills = config.db.collection("skills");
    this.userDirectoryRepo = config.userDirectoryRepo;
  }

  async listUsers(params: ListUsersParams): Promise<{
    items: AdminUserRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(200, Math.max(1, params.pageSize));
    const sortKey: SortKey = params.sort ?? "lastActiveAt";
    const dir: SortDir = params.dir ?? "desc";

    // 1) Pool of users matching role + email-prefix filter.
    const docs = await this.userDirectoryRepo.findAllInRole(
      params.role,
      params.q,
    );

    // 2) Enrich with skill counts from the `skills` collection.
    const userIds = docs.map((d) => d._id);
    const skillCounts =
      userIds.length === 0
        ? []
        : await this.skills
            .aggregate([
              { $match: { createdBy: { $in: userIds } } },
              { $group: { _id: "$createdBy", count: { $sum: 1 } } },
            ])
            .toArray();
    const skillCountMap = new Map(
      skillCounts.map((s) => [s._id as string, s.count as number]),
    );

    const enriched: AdminUserRow[] = docs.map((d) => ({
      userId: d._id,
      email: d.email ?? "",
      displayName: d.displayName ?? "",
      skillCount: skillCountMap.get(d._id) ?? 0,
      lastActiveAt:
        d.lastSeenAt instanceof Date ? d.lastSeenAt.toISOString() : null,
      activityCount: d.activityCount ?? 0,
      firstJoinedAt:
        d.firstSeenAt instanceof Date ? d.firstSeenAt.toISOString() : null,
    }));

    // 3) Sort + paginate.
    const sorted = [...enriched].sort(buildComparator(sortKey, dir));
    const total = sorted.length;
    const offset = (page - 1) * pageSize;
    const items = sorted.slice(offset, offset + pageSize);

    logger.debug(
      { role: params.role, page, pageSize, total, q: params.q ?? null },
      "Admin users list served",
    );

    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}

function buildComparator(
  sortKey: SortKey,
  dir: SortDir,
): (a: AdminUserRow, b: AdminUserRow) => number {
  const sign = dir === "asc" ? 1 : -1;
  const nullsLast = (
    v: string | number | null,
  ): [number, string | number] => {
    if (v === null || v === undefined) return [1, ""];
    return [0, v];
  };
  return (a, b) => {
    const av = nullsLast(a[sortKey]);
    const bv = nullsLast(b[sortKey]);
    if (av[0] !== bv[0]) return av[0] - bv[0];
    if (typeof av[1] === "number" && typeof bv[1] === "number") {
      return sign * (av[1] - bv[1]);
    }
    return sign * String(av[1]).localeCompare(String(bv[1]));
  };
}
