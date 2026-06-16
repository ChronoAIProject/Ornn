/**
 * One-time boot migration for #218 — drop legacy `share.*` and any other
 * out-of-vocabulary notifications.
 *
 * PR #198 removed the share/audit-gate workflow. The `NotificationCategory`
 * type was tightened at the same time. The current allowed vocabulary is
 * the canonical `NOTIFICATION_CATEGORIES` list (imported below), so this
 * migration and the type can never drift apart.
 *
 * Pre-#198 rows in the `notifications` collection still carry dead
 * categories like `share.needs_justification` and dead deep-links into
 * the removed `/shares/*` route tree (which now 404). They surface from
 * `GET /api/v1/notifications` and look broken to the user.
 *
 * This migration deletes any row whose `category` is not in the current
 * allowed set. Idempotent: subsequent runs find zero matching rows and
 * short-circuit.
 *
 * @module domains/notifications/migration
 */

import type { Db } from "mongodb";
import { createLogger } from "../../shared/logger";
import { NOTIFICATION_CATEGORIES } from "./types";

const logger = createLogger("notificationsMigration");

// Derive the allow-list from the canonical vocabulary (#1136) so a newly
// added category is never deleted on the next boot. Previously this was a
// hand-maintained copy that had already drifted (missing
// `launchPromo.codeDelivered`).
const ALLOWED_CATEGORIES = NOTIFICATION_CATEGORIES;

export async function dropLegacyNotificationCategories(db: Db): Promise<void> {
  const collection = db.collection("notifications");

  // Count first so the log line is informative even when nothing matches —
  // makes it obvious when re-running on a clean DB that the migration is
  // a no-op vs. silently doing nothing.
  const filter = { category: { $nin: ALLOWED_CATEGORIES } };
  const candidateCount = await collection.countDocuments(filter);
  if (candidateCount === 0) {
    logger.info(
      { allowedCategories: ALLOWED_CATEGORIES },
      "dropLegacyNotificationCategories: no out-of-vocabulary rows — nothing to migrate",
    );
    return;
  }

  // Surface a sample of which categories we're about to delete so an
  // operator reviewing logs can audit the change before the next deploy.
  const sample = await collection
    .aggregate<{ _id: unknown; count: number }>([
      { $match: filter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ])
    .toArray();

  logger.info(
    { candidateCount, sample, allowedCategories: ALLOWED_CATEGORIES },
    "dropLegacyNotificationCategories: deleting out-of-vocabulary rows",
  );

  const result = await collection.deleteMany(filter);
  logger.info(
    { deletedCount: result.deletedCount ?? 0 },
    "dropLegacyNotificationCategories: done",
  );
}
