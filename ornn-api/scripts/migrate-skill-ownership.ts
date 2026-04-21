/**
 * Migration: converge `skills` + `topics` on the post-ACL shape.
 *
 * Two columns on the `skills` collection need backfilling on pre-feature
 * rows:
 *
 *   1. `ownerId` — legacy back-compat field from the earlier
 *      "org-as-owner" design. Visibility logic no longer consults it, but
 *      the field is still written on new rows for safety. We set it to
 *      `createdBy` when absent.
 *   2. `sharedWithUsers` / `sharedWithOrgs` — the per-skill ACL lists
 *      introduced by the permissions feature. Pre-feature rows are
 *      missing both; we initialize them to `[]` so runtime reads don't
 *      have to fall back.
 *
 * The `topics` collection only needs the `ownerId` backfill — topics
 * don't carry their own ACL lists (the feature lives on skills only).
 *
 * Idempotent: a doc whose target fields are already set is left alone.
 * Re-runs converge to `updated=0`.
 *
 * Run with (from ornn-api/):
 *   MONGODB_URI=... MONGODB_DB=... bun run migrate:ownership
 */

import { MongoClient } from "mongodb";

function readConfig(): { mongoUri: string; mongoDb: string } {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  return {
    mongoUri,
    mongoDb: process.env.MONGODB_DB ?? "ornn",
  };
}

interface BackfillResult {
  scanned: number;
  updated: number;
  skippedNoCreatedBy: number;
}

/**
 * Backfill a single collection. `withAcl` controls whether the two ACL
 * list fields (`sharedWithUsers`, `sharedWithOrgs`) are also initialized
 * when absent. Skills get both; topics only get `ownerId`.
 */
async function backfillCollection(
  mongo: MongoClient,
  mongoDb: string,
  collectionName: string,
  withAcl: boolean,
): Promise<BackfillResult> {
  const collection = mongo.db(mongoDb).collection(collectionName);

  // Any row missing at least one of the target fields. Treats `""`/`null`
  // on `ownerId` the same as missing so partially migrated docs converge.
  const needle: Record<string, unknown> = {
    $or: [
      { ownerId: { $exists: false } },
      { ownerId: "" },
      { ownerId: null },
      ...(withAcl
        ? [
            { sharedWithUsers: { $exists: false } },
            { sharedWithOrgs: { $exists: false } },
          ]
        : []),
    ],
  };

  const cursor = collection.find(needle);
  let scanned = 0;
  let updated = 0;
  let skippedNoCreatedBy = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const createdBy = (doc.createdBy as string | undefined) ?? "";
    const existingOwner = (doc.ownerId as string | undefined) ?? "";

    if (!createdBy && !existingOwner) {
      // Can't derive an owner for rows missing both fields. Skip loudly
      // so someone can inspect the doc by hand.
      skippedNoCreatedBy += 1;
      continue;
    }

    const set: Record<string, unknown> = {};
    if (!existingOwner) {
      set.ownerId = createdBy;
    }
    if (withAcl) {
      if (!Array.isArray(doc.sharedWithUsers)) set.sharedWithUsers = [];
      if (!Array.isArray(doc.sharedWithOrgs)) set.sharedWithOrgs = [];
    }

    if (Object.keys(set).length === 0) continue;

    await collection.updateOne({ _id: doc._id }, { $set: set });
    updated += 1;
  }

  return { scanned, updated, skippedNoCreatedBy };
}

async function main(): Promise<void> {
  const config = readConfig();
  const mongo = new MongoClient(config.mongoUri);
  await mongo.connect();

  try {
    const skillsResult = await backfillCollection(mongo, config.mongoDb, "skills", true);
    const topicsResult = await backfillCollection(mongo, config.mongoDb, "topics", false);

    console.log(
      [
        "Ownership + ACL backfill complete:",
        `  skills   scanned=${skillsResult.scanned} updated=${skillsResult.updated} skipped=${skillsResult.skippedNoCreatedBy}`,
        `  topics   scanned=${topicsResult.scanned} updated=${topicsResult.updated} skipped=${topicsResult.skippedNoCreatedBy}`,
      ].join("\n"),
    );

    if (skillsResult.skippedNoCreatedBy > 0 || topicsResult.skippedNoCreatedBy > 0) {
      console.warn(
        "Some documents were skipped because `createdBy` was empty — inspect them manually.",
      );
      process.exitCode = 1;
    }
  } finally {
    await mongo.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
