/**
 * One-shot migration: drop the Topic feature from MongoDB.
 *
 * The Topic feature (skill groupings) was removed as the first step of
 * Epic 1 (see Refactor milestone, issue #67). Backend domain, frontend
 * UI, and API endpoints have already been deleted in code — this script
 * removes the corresponding collections from the live database.
 *
 * Optionally archives both collections to JSON before dropping, so data
 * can be recovered if product direction changes.
 *
 * Flow:
 *   1. Verify connection.
 *   2. If --archive (default on when ARCHIVE_DIR set): export `topics`
 *      and `topic_skills` to JSON files under $ARCHIVE_DIR/<date>/.
 *   3. If --dry-run: print what would be dropped and exit.
 *   4. Drop `topics` collection.
 *   5. Drop `topic_skills` collection.
 *
 * Idempotent: collections that don't exist are skipped without error.
 *
 * Run with (from ornn-api/):
 *   MONGODB_URI=... MONGODB_DB=... \
 *   [ARCHIVE_DIR=/tmp/ornn-archive] \
 *   bun run scripts/drop-topics.ts [--dry-run] [--no-archive]
 */

import { MongoClient } from "mongodb";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_ARCHIVE = process.argv.includes("--no-archive");

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB ?? "ornn";
const ARCHIVE_DIR = process.env.ARCHIVE_DIR;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required");
  process.exit(1);
}

const COLLECTIONS = ["topics", "topic_skills"] as const;

async function main(): Promise<void> {
  const client = new MongoClient(MONGODB_URI as string);
  await client.connect();
  const db = client.db(MONGODB_DB);

  console.log(`Connected to ${MONGODB_DB}`);
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  for (const name of COLLECTIONS) {
    if (!existing.has(name)) {
      console.log(`[${name}] collection does not exist — skipping`);
      continue;
    }

    const count = await db.collection(name).countDocuments();
    console.log(`[${name}] ${count} documents`);

    if (!NO_ARCHIVE && ARCHIVE_DIR && count > 0) {
      const docs = await db.collection(name).find({}).toArray();
      const stamp = new Date().toISOString().slice(0, 10);
      const dir = join(ARCHIVE_DIR, stamp);
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${name}.json`);
      if (DRY_RUN) {
        console.log(`[${name}] would archive to ${file}`);
      } else {
        await writeFile(file, JSON.stringify(docs, null, 2));
        console.log(`[${name}] archived to ${file}`);
      }
    } else if (!NO_ARCHIVE && !ARCHIVE_DIR && count > 0) {
      console.warn(
        `[${name}] ARCHIVE_DIR not set — skipping archive. Pass --no-archive to silence this warning.`,
      );
    }

    if (DRY_RUN) {
      console.log(`[${name}] would drop ${count} documents`);
    } else {
      await db.collection(name).drop();
      console.log(`[${name}] dropped`);
    }
  }

  await client.close();
  console.log(DRY_RUN ? "Dry-run complete" : "Migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
