/**
 * One-shot migration: backfill `ownerId` on every `skills` and `topics`
 * document that pre-dates the org-ownership feature.
 *
 * Historical context: before org-scoped skills, visibility pivoted on
 * `createdBy` alone. We've since split the two: `createdBy` is still the
 * author (always a person user_id), while `ownerId` holds the "owner
 * entity" — either the same person or an NyxID org user_id. Existing
 * documents were all personal, so the correct backfill is
 * `ownerId = createdBy`.
 *
 * Idempotent: documents that already have a non-empty `ownerId` are
 * skipped. Re-runs report `updated=0` once the backfill has landed.
 *
 * Why DB-direct here (instead of going through the API like the skill-versions
 * migration): we're only writing a single scalar that the API layer doesn't
 * know how to set. No storage blobs change, no hashing, no validation — a
 * Mongo `updateMany` is both correct and fast.
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

async function backfillCollection(
  mongo: MongoClient,
  mongoDb: string,
  collectionName: string,
): Promise<{ scanned: number; updated: number; skippedNoCreatedBy: number }> {
  const collection = mongo.db(mongoDb).collection(collectionName);

  // Skills/topics that have no `ownerId` yet — the ones we need to backfill.
  // Treat an empty string the same as missing so a re-run on a partially
  // migrated collection still converges.
  const needle = {
    $or: [{ ownerId: { $exists: false } }, { ownerId: "" }, { ownerId: null }],
  };

  const cursor = collection.find(needle);
  let scanned = 0;
  let updated = 0;
  let skippedNoCreatedBy = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const createdBy = (doc.createdBy as string | undefined) ?? "";
    if (!createdBy) {
      // Can't infer an owner. Skip loudly — something upstream is malformed
      // and we don't want to plant an invalid ownerId.
      skippedNoCreatedBy += 1;
      continue;
    }
    await collection.updateOne(
      { _id: doc._id },
      { $set: { ownerId: createdBy } },
    );
    updated += 1;
  }

  return { scanned, updated, skippedNoCreatedBy };
}

async function main(): Promise<void> {
  const config = readConfig();
  const mongo = new MongoClient(config.mongoUri);
  await mongo.connect();

  try {
    const skillsResult = await backfillCollection(mongo, config.mongoDb, "skills");
    const topicsResult = await backfillCollection(mongo, config.mongoDb, "topics");

    console.log(
      [
        "Ownership backfill complete:",
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
