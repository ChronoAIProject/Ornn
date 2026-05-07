/**
 * AdminDashboardService — totals tiles + recent activities.
 *
 * Tiles partition disjointly:
 *   users:  total = admin + normal     (admin via `admin_users` cache)
 *   skills: total = system + public + private
 *           system  = isSystemSkill: true
 *           public  = isPrivate: false ∧ isSystemSkill !== true
 *           private = isPrivate: true
 *
 * Recent activities reuse the existing activity repo unchanged.
 *
 * @module domains/admin/dashboard/service
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";
import type { ActivityRepository } from "../activityRepository";
import type { AdminUsersRepository } from "../../admin-users/repository";

const logger = pino({ level: "info" }).child({ module: "adminDashboardService" });

export interface DashboardStats {
  users: { total: number; admin: number; normal: number };
  skills: { total: number; system: number; public: number; private: number };
}

export interface DashboardServiceConfig {
  db: Db;
  activityRepo: ActivityRepository;
  adminUsersRepo: AdminUsersRepository;
}

export class AdminDashboardService {
  private readonly skills: Collection;
  private readonly activities: Collection;
  private readonly activityRepo: ActivityRepository;
  private readonly adminUsersRepo: AdminUsersRepository;

  constructor(config: DashboardServiceConfig) {
    this.skills = config.db.collection("skills");
    this.activities = config.db.collection("activities");
    this.activityRepo = config.activityRepo;
    this.adminUsersRepo = config.adminUsersRepo;
  }

  /**
   * Totals tiles. User totals come from the activities-derived user pool
   * (same source the existing admin/users endpoint uses) so the admin UI
   * is internally consistent. Skill totals query the `skills` collection
   * with the partition rule above.
   */
  async getStats(): Promise<DashboardStats> {
    const [
      adminUserIds,
      uniqueUserIds,
      systemCount,
      publicNonSystemCount,
      privateCount,
      total,
    ] = await Promise.all([
      this.adminUsersRepo.listUserIds(),
      this.activities.distinct("userId"),
      this.skills.countDocuments({ isSystemSkill: true }),
      this.skills.countDocuments({
        isPrivate: false,
        $or: [{ isSystemSkill: { $exists: false } }, { isSystemSkill: { $ne: true } }],
      }),
      this.skills.countDocuments({ isPrivate: true }),
      this.skills.countDocuments({}),
    ]);

    const totalUsers = uniqueUserIds.length;
    // adminUserIds may include rows for users who never logged activity.
    // Cap admin count by users actually present in the activity pool so
    // admin + normal sum exactly to total.
    const adminCount = uniqueUserIds.filter((id) => adminUserIds.has(id as string)).length;
    const normalCount = totalUsers - adminCount;

    const stats: DashboardStats = {
      users: { total: totalUsers, admin: adminCount, normal: normalCount },
      skills: {
        total,
        system: systemCount,
        public: publicNonSystemCount,
        private: privateCount,
      },
    };
    logger.debug(stats, "Dashboard stats computed");
    return stats;
  }

  /**
   * Most recent N platform activities, default 50. UI shows top-10 with
   * a "view all" deep-link to /admin/activities.
   */
  async listRecentActivities(limit = 50) {
    const result = await this.activityRepo.list({ page: 1, pageSize: limit });
    return result.items.map((row) => ({
      ...row,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  }
}
