/**
 * Boot migration (#1123) — backfill the typed `grants` array on skills and
 * skillsets created before the typed-grant model existed.
 *
 * Non-disruptive by construction, which is the hard requirement for this
 * feature: every legacy read-only grant (`sharedWithUsers` /
 * `sharedWithOrgs`) becomes a `read`-level typed grant, and the legacy lists
 * are LEFT IN PLACE (the repository dual-writes them during the rolling
 * deploy). Nobody is escalated to write; public skills are untouched (public
 * was, and stays, read-only — visibility is governed by `isPrivate`, not by
 * grants). After this runs, every doc carries `grants`, so the read/write
 * gates and scope filters can rely on it.
 *
 * Idempotent: only docs MISSING `grants` are matched, so reruns are no-ops.
 * Runs entirely server-side as one `updateMany` + aggregation pipeline per
 * collection — `$map` over each doc's own legacy lists, so it scales to the
 * whole collection in a single round-trip without pulling docs into the app.
 *
 * @module domains/skills/crud/grants.migration
 */

import type { Db } from "mongodb";
import { createLogger } from "../../../shared/logger";

const logger = createLogger("skillGrantsMigration");

/** The collections that carry the shared ownership/grant shape. */
const GRANTED_COLLECTIONS = ["skills", "skillsets"] as const;

/**
 * Aggregation `$set` stage that derives `grants` from the doc's own legacy
 * read lists — every entry at `read` level. `$ifNull` tolerates docs that
 * predate even the legacy lists.
 */
const BUILD_GRANTS_STAGE = {
  $set: {
    grants: {
      $concatArrays: [
        {
          $map: {
            input: { $ifNull: ["$sharedWithUsers", []] },
            as: "u",
            in: { type: "user", id: "$$u", level: "read" },
          },
        },
        {
          $map: {
            input: { $ifNull: ["$sharedWithOrgs", []] },
            as: "o",
            in: { type: "org", id: "$$o", level: "read" },
          },
        },
      ],
    },
  },
} as const;

export interface GrantsMigrationResult {
  skillsBackfilled: number;
  skillsetsBackfilled: number;
}

/**
 * Backfill typed `grants` on every skill / skillset missing the field.
 * Safe to call on every boot — see module doc.
 */
export async function backfillTypedGrants(db: Db): Promise<GrantsMigrationResult> {
  const counts: Record<string, number> = {};
  for (const coll of GRANTED_COLLECTIONS) {
    const res = await db
      .collection(coll)
      .updateMany({ grants: { $exists: false } }, [BUILD_GRANTS_STAGE]);
    counts[coll] = res.modifiedCount;
  }
  const result: GrantsMigrationResult = {
    skillsBackfilled: counts.skills ?? 0,
    skillsetsBackfilled: counts.skillsets ?? 0,
  };
  if (result.skillsBackfilled > 0 || result.skillsetsBackfilled > 0) {
    logger.info({ ...result }, "Typed-grants backfill complete (#1123)");
  }
  return result;
}

/**
 * Aggregation `$set` stage that renames any grant with the legacy
 * `read_write` level to `write` (#1127), leaving `read` grants untouched.
 */
const RENAME_LEVEL_STAGE = {
  $set: {
    grants: {
      $map: {
        input: { $ifNull: ["$grants", []] },
        as: "g",
        in: {
          $cond: [
            { $eq: ["$$g.level", "read_write"] },
            { $mergeObjects: ["$$g", { level: "write" }] },
            "$$g",
          ],
        },
      },
    },
  },
} as const;

export interface LevelRenameResult {
  skillsRenamed: number;
  skillsetsRenamed: number;
}

/**
 * Rename the legacy `read_write` grant level to `write` (#1127) on every
 * skill / skillset that still carries one. Idempotent — only docs with a
 * `read_write` grant are matched, so reruns are no-ops. Non-destructive:
 * `read` grants and all other fields are untouched, and a `write` grant
 * confers exactly what `read_write` did (write implies read). Runs at boot
 * after the typed-grants backfill; `coerceStoredGrants` covers any doc not
 * yet rewritten.
 */
export async function renameReadWriteGrantsToWrite(db: Db): Promise<LevelRenameResult> {
  const counts: Record<string, number> = {};
  for (const coll of GRANTED_COLLECTIONS) {
    const res = await db
      .collection(coll)
      .updateMany({ "grants.level": "read_write" }, [RENAME_LEVEL_STAGE]);
    counts[coll] = res.modifiedCount;
  }
  const result: LevelRenameResult = {
    skillsRenamed: counts.skills ?? 0,
    skillsetsRenamed: counts.skillsets ?? 0,
  };
  if (result.skillsRenamed > 0 || result.skillsetsRenamed > 0) {
    logger.info({ ...result }, "read_write → write grant-level rename complete (#1127)");
  }
  return result;
}
