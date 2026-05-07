#!/usr/bin/env bun
/**
 * Migrate the legacy `user_quotas` + `quota_grants` model into the new
 * calendar-month bucket model (Architecture §5.6).
 *
 * Operations performed:
 *   1. For each `user_quotas` row: emit one `quota_buckets` doc per
 *      surface for the CURRENT UTC month.
 *        - `defaultAllotment` = current platform default for the surface
 *        - `adminGrant` = sum of remaining (amount - consumed) over
 *          *active* legacy grants for the user/surface (expiresAt null
 *          OR > now)
 *        - `used` = old `monthlyUsed`
 *        - `usedByModel` = {} (we have no historical breakdown)
 *   2. Backfill `users_meta` rows from `MIN(activities.createdAt)`.
 *   3. Rename `quota_grants` → `_archive_quota_grants` and add a 90-day
 *      TTL index so the audit trail self-disposes.
 *   4. For each user who held a multi-month grant in the old ledger,
 *      emit one `notifyQuotaModelChange` notification (Story 10.3).
 *
 * Idempotent — safe to re-run. Per-user before/after is logged at
 * `info`. `--dry-run` skips writes and reports what *would* change.
 *
 * Usage:
 *   bun run ornn-api/scripts/migrate-quota-to-buckets.ts [--dry-run]
 *
 * @module scripts/migrate-quota-to-buckets
 */

import type { Collection, Db } from "mongodb";
import { MongoClient } from "mongodb";
import pino from "pino";
import { NotificationRepository } from "../src/domains/notifications/repository";
import { NotificationService } from "../src/domains/notifications/service";
import {
  QuotaRepository,
  type UpsertGrantParams,
} from "../src/domains/quota/repository";
import { bucketId, monthBounds } from "../src/domains/quota/types";
import { UsersMetaRepository } from "../src/domains/admin-users/usersMetaRepository";

const logger = pino({ level: "info" }).child({ module: "migrateQuotaToBuckets" });

export interface MigrationOptions {
  /** When true, no writes are performed. */
  dryRun?: boolean;
  /** Default monthly allotment for the playground surface. */
  defaultPlaygroundMonthly: number;
  /** Default monthly allotment for the skillGen surface. */
  defaultSkillGenMonthly: number;
  /**
   * Clock injection (test-friendly). Defaults to `new Date()`.
   * Important: every operation in a single `migrate(db)` call uses the
   * SAME `now` so the produced state is deterministic across users.
   */
  now?: Date;
  /**
   * Optional notification fanout. When provided, story 10.3 notices
   * are emitted; missing → notifications are skipped (used by tests
   * that don't care about that path).
   */
  notificationService?: Pick<NotificationService, "notifyQuotaModelChange">;
}

export interface MigrationReport {
  userQuotas: { migrated: number; alreadyMigrated: number };
  bucketsWritten: number;
  archivedGrants: number;
  usersMetaWritten: number;
  notifiedUsers: number;
  dryRun: boolean;
}

interface OldUserQuotaDoc {
  userId: string;
  playground?: { monthlyUsed?: number; creditsBalance?: number };
  skillGen?: { monthlyUsed?: number; creditsBalance?: number };
}

interface OldGrantDoc {
  _id: string;
  targetUserId: string;
  surface: "playground" | "skillGen";
  amount: number;
  consumed?: number;
  expiresAt?: Date | null;
  createdAt?: Date;
}

const OLD_GRANTS_COLLECTION = "quota_grants";
const ARCHIVE_GRANTS_COLLECTION = "_archive_quota_grants";

export async function migrate(db: Db, opts: MigrationOptions): Promise<MigrationReport> {
  const dryRun = !!opts.dryRun;
  const now = opts.now ?? new Date();
  const { monthMarker, monthStart, monthEnd } = monthBounds(now);
  const quotaRepo = new QuotaRepository(db);
  const usersMetaRepo = new UsersMetaRepository(db);

  const oldQuotas = db.collection<OldUserQuotaDoc>("user_quotas");
  const oldGrants = db.collection<OldGrantDoc>(OLD_GRANTS_COLLECTION);
  const archive = db.collection<OldGrantDoc>(ARCHIVE_GRANTS_COLLECTION);
  const buckets = db.collection("quota_buckets");

  const report: MigrationReport = {
    userQuotas: { migrated: 0, alreadyMigrated: 0 },
    bucketsWritten: 0,
    archivedGrants: 0,
    usersMetaWritten: 0,
    notifiedUsers: 0,
    dryRun,
  };

  // -- 1. user_quotas → quota_buckets ---------------------------------
  const cursor = oldQuotas.find({});
  for await (const old of cursor) {
    const userId = old.userId;
    if (!userId) continue;

    for (const surface of ["playground", "skillGen"] as const) {
      const sub = old[surface];
      if (!sub) continue;
      const def =
        surface === "playground"
          ? opts.defaultPlaygroundMonthly
          : opts.defaultSkillGenMonthly;

      // Sum active legacy grants for this user/surface that overlap the
      // current month.
      const adminGrant = await sumActiveGrants(oldGrants, userId, surface, now);
      const used = sub.monthlyUsed ?? 0;
      // Legacy `creditsBalance` (non-expiring bucket) folds into adminGrant.
      const totalAdminGrant = adminGrant + (sub.creditsBalance ?? 0);

      const id = bucketId(userId, surface, monthMarker);
      const before = await buckets.findOne({ _id: id as never });

      logger.info(
        {
          userId,
          surface,
          monthMarker,
          before: before
            ? {
                used: (before as { used: number }).used,
                adminGrant: (before as { adminGrant: number }).adminGrant,
              }
            : null,
          after: { used, adminGrant: totalAdminGrant, defaultAllotment: def },
        },
        "Migrating user/surface bucket",
      );

      if (before) {
        report.userQuotas.alreadyMigrated += 1;
        continue;
      }

      if (!dryRun) {
        await buckets.insertOne({
          _id: id as never,
          userId,
          surface,
          monthMarker,
          monthStart,
          monthEnd,
          defaultAllotment: def,
          adminGrant: totalAdminGrant,
          used,
          usedByModel: {},
          createdAt: now,
          updatedAt: now,
        });
        report.bucketsWritten += 1;
      }
    }
    report.userQuotas.migrated += 1;
  }

  // -- 2. users_meta backfill (firstJoinedAt from MIN activities) -----
  const distinctUserIds = await db.collection("activities").distinct("userId");
  for (const userId of distinctUserIds) {
    if (typeof userId !== "string" || userId.length === 0) continue;
    if (dryRun) {
      const existing = await db.collection("users_meta").findOne({ _id: userId as never });
      if (!existing) report.usersMetaWritten += 1;
      continue;
    }
    const existing = await db.collection("users_meta").findOne({ _id: userId as never });
    if (existing) continue;
    await usersMetaRepo.compute(userId);
    report.usersMetaWritten += 1;
  }

  // -- 3. Archive `quota_grants` and emit notifications ---------------
  const archivedAlready = await archive
    .countDocuments({})
    .catch(() => 0);
  const grantsExist = await db.listCollections({ name: OLD_GRANTS_COLLECTION }).toArray();
  if (grantsExist.length > 0 && archivedAlready === 0 && !dryRun) {
    // Identify "multi-month grant" holders before we move the data.
    const multiMonthRows = await oldGrants
      .find({ expiresAt: { $ne: null } })
      .toArray();
    const userMonthsByUser = new Map<string, string>();
    for (const row of multiMonthRows) {
      const expires = row.expiresAt;
      if (!(expires instanceof Date)) continue;
      const span = monthBounds(expires).monthMarker;
      if (!userMonthsByUser.has(row.targetUserId)) {
        userMonthsByUser.set(row.targetUserId, span);
      }
    }
    // Move docs to the archive collection.
    const all = await oldGrants.find({}).toArray();
    if (all.length > 0) {
      await archive.insertMany(all);
      report.archivedGrants = all.length;
    }
    await db.collection(OLD_GRANTS_COLLECTION).drop().catch(() => {});
    // 90-day TTL on the archive (per-row from createdAt).
    try {
      await archive.createIndex(
        { createdAt: 1 },
        {
          name: "ttl_90d",
          expireAfterSeconds: 90 * 24 * 60 * 60,
        },
      );
    } catch (err) {
      logger.warn({ err }, "Could not create TTL index on archive — proceeding");
    }

    // 4. Story 10.3 notifications.
    if (opts.notificationService) {
      for (const [userId, span] of userMonthsByUser.entries()) {
        try {
          await opts.notificationService.notifyQuotaModelChange({
            targetUserId: userId,
            monthMarker: span,
          });
          report.notifiedUsers += 1;
        } catch (err) {
          logger.warn({ err, userId }, "notifyQuotaModelChange failed — continuing");
        }
      }
    }
  } else if (grantsExist.length > 0 && dryRun) {
    report.archivedGrants = await oldGrants.countDocuments({});
  }

  // Reserve the unused quotaRepo handle for future migration steps.
  void quotaRepo;
  logger.info(report, "Quota migration complete");
  return report;
}

async function sumActiveGrants(
  oldGrants: Collection<OldGrantDoc>,
  userId: string,
  surface: "playground" | "skillGen",
  now: Date,
): Promise<number> {
  const exists = await oldGrants
    .countDocuments({ targetUserId: userId, surface }, { limit: 1 })
    .catch(() => 0);
  if (exists === 0) return 0;
  const cursor = oldGrants.aggregate<{ total: number }>([
    {
      $match: {
        targetUserId: userId,
        surface,
        $expr: { $lt: [{ $ifNull: ["$consumed", 0] }, "$amount"] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $subtract: ["$amount", { $ifNull: ["$consumed", 0] }] },
        },
      },
    },
  ]);
  const rows = await cursor.toArray();
  return rows[0]?.total ?? 0;
}

// CLI entrypoint -----------------------------------------------------------
if (import.meta.main) {
  const dryRun = process.argv.includes("--dry-run");
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? "ornn";
  if (!uri) {
    console.error("MONGODB_URI is required");
    process.exit(1);
  }
  const defaultPlayground = Number(process.env.DEFAULT_PLAYGROUND_MONTHLY ?? "200");
  const defaultSkillGen = Number(process.env.DEFAULT_SKILLGEN_MONTHLY ?? "20");
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const notifRepo = new NotificationRepository(db);
    const notifService = new NotificationService({ notificationRepo: notifRepo });
    const report = await migrate(db, {
      dryRun,
      defaultPlaygroundMonthly: defaultPlayground,
      defaultSkillGenMonthly: defaultSkillGen,
      notificationService: notifService,
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.close();
  }
}
