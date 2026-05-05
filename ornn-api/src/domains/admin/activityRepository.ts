/**
 * Activity repository for tracking user actions.
 * @module domains/admin/activityRepository
 */

import type { Collection, Db } from "mongodb";
import { randomUUID } from "node:crypto";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "activityRepository" });

export type ActivityAction =
  | "login"
  | "logout"
  | "skill:create"
  | "skill:update"
  | "skill:delete"
  | "skill:version_delete"
  | "skill:visibility_change"
  | "skill:permissions_change"
  | "skill:refresh"
  | "skill:nyxid_service_tie"
  | "skill:source_link"
  | "skill:source_unlink";

export interface ActivityDocument {
  _id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  action: ActivityAction;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface UserSummary {
  userId: string;
  email: string;
  displayName: string;
  lastActiveAt: string;
  skillCount: number;
  activityCount: number;
}

export class ActivityRepository {
  private readonly collection: Collection<ActivityDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ActivityDocument>("activities");
    this.ensureIndexes().catch((err) =>
      logger.error({ err }, "Failed to create activity indexes"),
    );
  }

  private async ensureIndexes(): Promise<void> {
    await this.collection.createIndex({ userId: 1 });
    await this.collection.createIndex({ action: 1 });
    await this.collection.createIndex({ createdAt: -1 });
  }

  async log(
    userId: string,
    userEmail: string,
    userDisplayName: string,
    action: ActivityAction,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    const doc: ActivityDocument = {
      _id: randomUUID() as unknown as string,
      userId,
      userEmail,
      userDisplayName,
      action,
      details,
      createdAt: new Date(),
    };
    await this.collection.insertOne(doc);
    logger.info({ userId, action, details }, "Activity logged");
  }

  async list(params: {
    page: number;
    pageSize: number;
    action?: ActivityAction;
    userId?: string;
  }): Promise<{ items: ActivityDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.action) filter.action = params.action;
    if (params.userId) filter.userId = params.userId;

    const total = await this.collection.countDocuments(filter);
    const offset = (params.page - 1) * params.pageSize;
    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(params.pageSize)
      .toArray();

    return {
      items: docs as unknown as ActivityDocument[],
      total,
    };
  }

  /**
   * Email-prefix search over the aggregated user pool derived from
   * activities. Used by the permissions panel's "share with users"
   * typeahead so authors can pick collaborators by email without needing
   * admin access to NyxID.
   *
   * Returns at most `limit` entries, sorted by most-recently-active so
   * inactive accounts don't clutter the suggestions. When `emailPrefix`
   * is empty the full pool is returned (top-N by recency) — this powers
   * the on-focus "show everyone" behavior in the picker.
   */
  async searchUsersByEmail(
    emailPrefix: string,
    limit: number,
  ): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    const trimmed = emailPrefix.trim();

    const matchStage = trimmed
      ? {
          $match: {
            userEmail: {
              $regex: `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
              $options: "i",
            },
          },
        }
      : { $match: { userEmail: { $ne: "" } } };

    const pipeline = [
      matchStage,
      {
        $group: {
          _id: "$userId",
          email: { $last: "$userEmail" },
          displayName: { $last: "$userDisplayName" },
          lastActiveAt: { $max: "$createdAt" },
        },
      },
      { $sort: { lastActiveAt: -1 as const } },
      { $limit: limit },
    ];

    const rows = await this.collection.aggregate(pipeline).toArray();
    return rows
      .filter((r) => typeof r._id === "string" && r._id.length > 0)
      .map((r) => ({
        userId: r._id as string,
        email: (r.email as string) ?? "",
        displayName: (r.displayName as string) ?? "",
      }));
  }

  /**
   * Batch-resolve userIds to their last-known email/displayName. Keyed
   * on the activity log — a user who never interacted with Ornn won't
   * be present. Order is not guaranteed; callers should build their
   * own map if positional ordering matters.
   */
  async findByUserIds(
    userIds: string[],
  ): Promise<Array<{ userId: string; email: string; displayName: string }>> {
    if (userIds.length === 0) return [];
    // Same "latest non-empty" pattern as `aggregateUsers` — the naive
    // $last surfaces the single most-recent row's labels, which can
    // legitimately be empty when the most recent JWT lacked email/name.
    const pipeline = [
      { $match: { userId: { $in: userIds } } },
      { $sort: { createdAt: -1 as const } },
      {
        $group: {
          _id: "$userId",
          emails: { $push: "$userEmail" },
          displayNames: { $push: "$userDisplayName" },
          lastActiveAt: { $max: "$createdAt" },
        },
      },
      {
        $project: {
          _id: 1,
          email: {
            $first: {
              $filter: {
                input: "$emails",
                cond: {
                  $and: [
                    { $ne: ["$$this", null] },
                    { $ne: ["$$this", ""] },
                  ],
                },
              },
            },
          },
          displayName: {
            $first: {
              $filter: {
                input: "$displayNames",
                cond: {
                  $and: [
                    { $ne: ["$$this", null] },
                    { $ne: ["$$this", ""] },
                  ],
                },
              },
            },
          },
          lastActiveAt: 1,
        },
      },
    ];
    const rows = await this.collection.aggregate(pipeline).toArray();
    return rows
      .filter((r) => typeof r._id === "string" && r._id.length > 0)
      .map((r) => ({
        userId: r._id as string,
        email: (r.email as string) ?? "",
        displayName: (r.displayName as string) ?? "",
      }));
  }

  /**
   * Aggregate unique users from activities + skill ownership.
   * Returns user summaries with last activity time and skill count.
   *
   * For each unique `userId`, surface the most-recent NON-EMPTY email
   * + displayName from the activity history. The naive $last picks the
   * single most-recent row, which means a user whose latest activity
   * happened to be authenticated by a JWT lacking `email`/`name`
   * claims (some admin / proxy / SA-flavored login paths emit those
   * empty) shows up blank in the admin user list — even though they
   * have many earlier activities with the labels populated.
   */
  async aggregateUsers(
    skillCollection: Collection,
    page: number,
    pageSize: number,
  ): Promise<{ items: UserSummary[]; total: number }> {
    const pipeline = [
      // Sort desc so $push below preserves newest-first order, and the
      // "first non-empty" projection downstream picks the most-recent
      // populated value rather than any older one.
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
                cond: {
                  $and: [
                    { $ne: ["$$this", null] },
                    { $ne: ["$$this", ""] },
                  ],
                },
              },
            },
          },
          displayName: {
            $first: {
              $filter: {
                input: "$displayNames",
                cond: {
                  $and: [
                    { $ne: ["$$this", null] },
                    { $ne: ["$$this", ""] },
                  ],
                },
              },
            },
          },
          lastActiveAt: 1,
          activityCount: 1,
        },
      },
      { $sort: { lastActiveAt: -1 as const } },
    ];

    const allUsers = await this.collection.aggregate(pipeline).toArray();
    const total = allUsers.length;
    const paged = allUsers.slice((page - 1) * pageSize, page * pageSize);

    // Enrich with skill counts
    const userIds = paged.map((u) => u._id);
    const skillCounts = await skillCollection
      .aggregate([
        { $match: { createdBy: { $in: userIds } } },
        { $group: { _id: "$createdBy", count: { $sum: 1 } } },
      ])
      .toArray();

    const skillCountMap = new Map(skillCounts.map((s) => [s._id, s.count]));

    const items: UserSummary[] = paged.map((u) => ({
      userId: u._id as string,
      email: (u.email as string) || "",
      displayName: (u.displayName as string) || "",
      lastActiveAt:
        u.lastActiveAt instanceof Date
          ? u.lastActiveAt.toISOString()
          : String(u.lastActiveAt),
      skillCount: (skillCountMap.get(u._id) as number) ?? 0,
      activityCount: u.activityCount as number,
    }));

    return { items, total };
  }

  /** Get dashboard stats. */
  async getStats(skillCollection: Collection): Promise<{
    totalUsers: number;
    totalSkills: number;
    publicSkills: number;
    privateSkills: number;
    recentActivities: number;
  }> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalUsers, totalSkills, publicSkills, recentActivities] =
      await Promise.all([
        this.collection.distinct("userId").then((ids) => ids.length),
        skillCollection.countDocuments(),
        skillCollection.countDocuments({ isPrivate: false }),
        this.collection.countDocuments({ createdAt: { $gte: oneDayAgo } }),
      ]);

    return {
      totalUsers,
      totalSkills,
      publicSkills,
      privateSkills: totalSkills - publicSkills,
      recentActivities,
    };
  }
}
