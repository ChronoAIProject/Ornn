/**
 * AdminDashboardService — totals tiles for the admin dashboard.
 *
 * After issue #271 the activity feed lives in PostHog; the recent-
 * activities listing is no longer surfaced from this service. The
 * frontend deep-links into the PostHog "Activity" view instead.
 *
 * Tiles partition disjointly:
 *   users:  total = admin + normal     (from `users` directory)
 *   skills: total = system + public + private
 *           system  = isSystemSkill: true
 *           public  = isPrivate: false ∧ isSystemSkill !== true
 *           private = isPrivate: true
 *
 * @module domains/admin/dashboard/service
 */

import type { Collection, Db } from "mongodb";
import pino from "pino";
import type { UserDirectoryRepository } from "../../users/repository";

const logger = pino({ level: "info" }).child({ module: "adminDashboardService" });

export interface DashboardStats {
  users: { total: number; admin: number; normal: number };
  skills: { total: number; system: number; public: number; private: number };
}

export interface DashboardServiceConfig {
  db: Db;
  userDirectoryRepo: UserDirectoryRepository;
}

export class AdminDashboardService {
  private readonly skills: Collection;
  private readonly userDirectoryRepo: UserDirectoryRepository;

  constructor(config: DashboardServiceConfig) {
    this.skills = config.db.collection("skills");
    this.userDirectoryRepo = config.userDirectoryRepo;
  }

  /**
   * Totals tiles. User totals come from the user directory (every
   * authenticated request lazily upserts). Skill totals query the
   * `skills` collection with the partition rule above.
   */
  async getStats(): Promise<DashboardStats> {
    const [
      users,
      systemCount,
      publicNonSystemCount,
      privateCount,
      total,
    ] = await Promise.all([
      this.userDirectoryRepo.countByRole(),
      this.skills.countDocuments({ isSystemSkill: true }),
      this.skills.countDocuments({
        isPrivate: false,
        $or: [{ isSystemSkill: { $exists: false } }, { isSystemSkill: { $ne: true } }],
      }),
      this.skills.countDocuments({ isPrivate: true }),
      this.skills.countDocuments({}),
    ]);

    const stats: DashboardStats = {
      users,
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
}
