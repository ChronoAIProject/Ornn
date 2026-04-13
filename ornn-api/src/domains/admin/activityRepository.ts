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
  | "skill:visibility_change";

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
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("activities");
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
    const doc = {
      _id: randomUUID(),
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
   * Aggregate unique users from activities + skill ownership.
   * Returns user summaries with last activity time and skill count.
   */
  async aggregateUsers(
    skillCollection: Collection,
    page: number,
    pageSize: number,
  ): Promise<{ items: UserSummary[]; total: number }> {
    // Get unique users from activities
    const pipeline = [
      {
        $group: {
          _id: "$userId",
          email: { $last: "$userEmail" },
          displayName: { $last: "$userDisplayName" },
          lastActiveAt: { $max: "$createdAt" },
          activityCount: { $sum: 1 },
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
