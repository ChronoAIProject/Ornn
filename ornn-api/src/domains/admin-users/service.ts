/**
 * AdminUsersService — paginated admin/normal user lists with the six
 * columns specified in Story 4.1/4.2:
 *   `displayName`, `email`, `skillCount`, `lastActiveAt`,
 *   `activityCount`, `firstJoinedAt`.
 *
 * Sources:
 *   - Activities aggregated for `lastActiveAt`, `activityCount`.
 *   - `users_meta.firstJoinedAt` (synthesized from MIN(activities.createdAt))
 *     — see Architecture §3.5.
 *   - Skill ownership count from `skills.createdBy`.
 *   - Admin set from `admin_users` (lazy display cache).
 *
 * @module domains/admin-users/service
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";
import type { ActivityRepository } from "../admin/activityRepository";
import type { AdminUsersRepository } from "./repository";
import type { UsersMetaRepository } from "./usersMetaRepository";

const logger = pino({ level: "info" }).child({ module: "adminUsersService" });

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
  activityRepo: ActivityRepository;
  adminUsersRepo: AdminUsersRepository;
  usersMetaRepo: UsersMetaRepository;
}

export class AdminUsersService {
  private readonly skills: Collection;
  private readonly activities: Collection;
  private readonly activityRepo: ActivityRepository;
  private readonly adminUsersRepo: AdminUsersRepository;
  private readonly usersMetaRepo: UsersMetaRepository;

  constructor(config: AdminUsersServiceConfig) {
    this.skills = config.db.collection("skills");
    this.activities = config.db.collection("activities");
    this.activityRepo = config.activityRepo;
    this.adminUsersRepo = config.adminUsersRepo;
    this.usersMetaRepo = config.usersMetaRepo;
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

    // 1) Aggregate the activity-derived user pool with email/display
    //    (most recent non-empty), lastActiveAt, activityCount.
    const matchStage = params.q
      ? {
          $match: {
            userEmail: {
              $regex: `^${params.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
              $options: "i",
            },
          },
        }
      : { $match: { userEmail: { $ne: "" } } };
    const pipeline = [
      matchStage,
      { $sort: { createdAt: -1 as const } },
      {
        $group: {
          _id: "$userId",
          emails: { $push: "$userEmail" },
          displayNames: { $push: "$userDisplayName" },
          lastActiveAt: { $max: "$createdAt" },
          activityCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 1,
          email: {
            $first: {
              $filter: {
                input: "$emails",
                cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
              },
            },
          },
          displayName: {
            $first: {
              $filter: {
                input: "$displayNames",
                cond: { $and: [{ $ne: ["$$this", null] }, { $ne: ["$$this", ""] }] },
              },
            },
          },
          lastActiveAt: 1,
          activityCount: 1,
        },
      },
    ];
    const allRows = await this.activities.aggregate(pipeline).toArray();

    // 2) Filter by role.
    const adminIds = await this.adminUsersRepo.listUserIds();
    const filtered = allRows.filter((r) => {
      const isAdmin = adminIds.has(r._id as string);
      return params.role === "admin" ? isAdmin : !isAdmin;
    });

    // 3) Enrich with skillCount + firstJoinedAt (cached).
    const userIds = filtered.map((r) => r._id as string);
    const [skillCounts, metaRows] = await Promise.all([
      this.skills
        .aggregate([
          { $match: { createdBy: { $in: userIds } } },
          { $group: { _id: "$createdBy", count: { $sum: 1 } } },
        ])
        .toArray(),
      this.usersMetaRepo.batchGetOrCompute(userIds),
    ]);
    const skillCountMap = new Map(skillCounts.map((s) => [s._id as string, s.count as number]));
    const metaMap = new Map(metaRows.map((m) => [m._id, m]));

    const enriched: AdminUserRow[] = filtered.map((r) => {
      const meta = metaMap.get(r._id as string);
      return {
        userId: r._id as string,
        email: (r.email as string) ?? meta?.email ?? "",
        displayName: (r.displayName as string) ?? meta?.displayName ?? "",
        skillCount: skillCountMap.get(r._id as string) ?? 0,
        lastActiveAt:
          r.lastActiveAt instanceof Date
            ? r.lastActiveAt.toISOString()
            : r.lastActiveAt
              ? String(r.lastActiveAt)
              : null,
        activityCount: r.activityCount as number,
        firstJoinedAt: meta?.firstJoinedAt
          ? meta.firstJoinedAt instanceof Date
            ? meta.firstJoinedAt.toISOString()
            : String(meta.firstJoinedAt)
          : null,
      };
    });

    // 4) Sort + paginate.
    const sorted = [...enriched].sort(buildComparator(sortKey, dir));
    const total = sorted.length;
    const offset = (page - 1) * pageSize;
    const items = sorted.slice(offset, offset + pageSize);

    logger.debug(
      { role: params.role, page, pageSize, total, q: params.q ?? null },
      "Admin users list served",
    );
    // Reserve the unused activityRepo handle for future targeted look-ups
    // (e.g. activity drill-down per user). Keeping it on the service so
    // we don't have to rewire the constructor for that follow-up.
    void this.activityRepo;
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
  const nullsLast = (v: string | number | null): [number, string | number] => {
    if (v === null || v === undefined) return [1, ""];
    return [0, v];
  };
  return (a, b) => {
    const av = nullsLast(a[sortKey]);
    const bv = nullsLast(b[sortKey]);
    // Nulls always last, regardless of direction.
    if (av[0] !== bv[0]) return av[0] - bv[0];
    if (typeof av[1] === "number" && typeof bv[1] === "number") {
      return sign * (av[1] - bv[1]);
    }
    return sign * String(av[1]).localeCompare(String(bv[1]));
  };
}
