/**
 * One-shot boot migration: backfill `recipientUserIds: null` on
 * pre-#502 broadcast docs.
 *
 * #500 shipped broadcasts as an everyone-message — every doc has no
 * `recipientUserIds` field. #502 introduces targeted broadcasts and
 * stores the canonical "everyone" sentinel as an explicit `null`.
 *
 * To keep feed-time consumers from having to branch on `undefined ||
 * null`, this migration writes an explicit `null` on every doc where
 * the field is absent. New broadcasts are already inserted with an
 * explicit `null` (see `BroadcastRepository.create`), so this is
 * strictly a one-shot backfill for pre-existing rows.
 *
 * Idempotency: only matches docs missing `recipientUserIds`. Re-runs
 * are no-ops. Failure is non-fatal — the repo mapper's `Array.isArray`
 * guard normalises absent fields to `null` on the read path, so feed
 * filtering keeps working even if the migration is delayed.
 *
 * @module domains/broadcasts/migration
 */

import type { Db } from "mongodb";
import type pino from "pino";

export async function backfillBroadcastRecipientUserIds(
  db: Db,
  logger: pino.Logger,
): Promise<void> {
  const coll = db.collection("broadcasts");

  // Match docs where the field is entirely absent. `$exists: false`
  // intentionally excludes docs that already carry an explicit `null`
  // (which would be the case on a second boot or on rows created
  // post-#502) — those don't need to be touched.
  const filter = { recipientUserIds: { $exists: false } };
  let result;
  try {
    result = await coll.updateMany(filter, { $set: { recipientUserIds: null } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "broadcasts recipientUserIds backfill failed — mapper fallback will cover reads, retry on next boot",
    );
    return;
  }

  if (result.matchedCount > 0) {
    logger.info(
      { matched: result.matchedCount, modified: result.modifiedCount },
      "broadcasts recipientUserIds backfill: set null on pre-#502 docs",
    );
  } else {
    logger.debug(
      "broadcasts recipientUserIds backfill: no pre-#502 docs found — nothing to backfill",
    );
  }
}
