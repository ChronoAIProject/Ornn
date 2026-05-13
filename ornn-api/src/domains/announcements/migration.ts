/**
 * One-shot boot migration: backfill bilingual fields on existing
 * announcement docs.
 *
 * Existing docs (created before this PR) carry single-locale columns:
 *   - `title: string`
 *   - `bodyMarkdown: string`
 *   - `ctaLabel: string | null`
 *
 * This PR introduces per-locale columns:
 *   - `titleEn`, `titleZh`
 *   - `bodyMarkdownEn`, `bodyMarkdownZh`
 *   - `ctaLabelEn`, `ctaLabelZh`
 *
 * On first boot of the new code, copy the legacy value into BOTH the
 * `*En` and `*Zh` slot so existing announcements render unchanged in
 * both languages. The admin can later translate the ZH variant via
 * the admin UI; until then, the new "optional fallback" rule on the
 * frontend renders EN content even when the user is on ZH (correct
 * behaviour for "we haven't translated this yet" content).
 *
 * Idempotency: only operates on docs missing `titleEn`. Re-runs are
 * no-ops. The legacy columns (`title`, `bodyMarkdown`, `ctaLabel`) are
 * left in place — they cost nothing and the repo's `mapDoc` already
 * falls back to them when the per-locale columns aren't set (defence
 * in depth for any doc the migration somehow missed).
 *
 * @module domains/announcements/migration
 */

import type { Db, Document } from "mongodb";
import type pino from "pino";

export async function migrateAnnouncementsToBilingual(
  db: Db,
  logger: pino.Logger,
): Promise<void> {
  const coll = db.collection("announcements");

  // Aggregate update — pipeline form lets `$set` reference other fields
  // on the same doc (the legacy single-locale columns). Filtered to
  // docs that haven't already been migrated (`titleEn` absent).
  let result;
  try {
    result = await coll.updateMany(
      { titleEn: { $exists: false } },
      [
        {
          $set: {
            titleEn: { $ifNull: ["$title", ""] },
            titleZh: { $ifNull: ["$title", ""] },
            bodyMarkdownEn: { $ifNull: ["$bodyMarkdown", ""] },
            bodyMarkdownZh: { $ifNull: ["$bodyMarkdown", ""] },
            ctaLabelEn: { $ifNull: ["$ctaLabel", null] },
            ctaLabelZh: { $ifNull: ["$ctaLabel", null] },
          } as Document,
        },
      ],
    );
  } catch (err) {
    // Don't crash the pod on a migration glitch — the repo's mapper
    // falls back to legacy fields, so reads keep working. Log loudly
    // so we notice. Subsequent boots will retry the migration.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "announcements bilingual migration failed — repo fallback will cover reads, retry on next boot",
    );
    return;
  }

  if (result.matchedCount > 0) {
    logger.info(
      {
        matched: result.matchedCount,
        modified: result.modifiedCount,
      },
      "announcements bilingual migration: backfilled per-locale columns from legacy single-locale fields",
    );
  } else {
    logger.debug(
      "announcements bilingual migration: no legacy docs found — nothing to backfill",
    );
  }
}
