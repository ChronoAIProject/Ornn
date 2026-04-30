/**
 * Migration: backfill `createdByEmail` + `createdByDisplayName` on
 * skill documents that pre-date the cache-at-create-time behavior.
 *
 * The Skill Detail / Skill Card UI renders the author with a fallback
 * chain `createdByDisplayName → createdByEmail → createdBy`. Older
 * skills only have `createdBy` (the NyxID user_id UUID) populated, so
 * the UI shows the raw UUID. New skills populate both at create time.
 *
 * This script joins `skills.createdBy` against the most-recent matching
 * `activities.userId` row to fish out the user's last-known email and
 * display name, and writes them back onto the skill doc.
 *
 * Idempotent: skills that already have both fields set are skipped. A
 * skill whose `createdBy` doesn't appear in `activities` (user never
 * signed into Ornn) is left untouched and reported as `unresolved`.
 *
 * Run with (from ornn-api/):
 *   MONGODB_URI=... MONGODB_DB=... bun run scripts/backfill-skill-author-display-names.ts
 *
 * Optional flags:
 *   --dry-run       Read-only; report what would change without writing.
 *   --limit=N       Stop after the first N skill rows (debug aid).
 */

import { MongoClient } from "mongodb";

interface Config {
  mongoUri: string;
  mongoDb: string;
  dryRun: boolean;
  limit: number | null;
}

function readConfig(): Config {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");
  const argv = Bun.argv.slice(2);
  const limitArg = argv.find((a) => a.startsWith("--limit="));
  return {
    mongoUri,
    mongoDb: process.env.MONGODB_DB ?? "ornn",
    dryRun: argv.includes("--dry-run"),
    limit: limitArg ? Number(limitArg.split("=")[1]) : null,
  };
}

interface SkillRow {
  _id: string;
  guid?: string;
  name?: string;
  createdBy?: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
}

interface DirectoryRow {
  _id: string;
  email: string;
  displayName: string;
}

async function main(): Promise<void> {
  const cfg = readConfig();
  const client = new MongoClient(cfg.mongoUri);
  await client.connect();
  try {
    const db = client.db(cfg.mongoDb);
    const skills = db.collection<SkillRow>("skills");
    const activities = db.collection("activities");

    // Any skill missing OR holding empty author labels. A skill where
    // both fields equal `createdBy` (UI fallback already kicked in) is
    // also targeted — that means a previous reads-side fallback has
    // poisoned the cached field with the UUID.
    const needle = {
      createdBy: { $exists: true, $type: "string", $ne: "" },
      $or: [
        { createdByDisplayName: { $exists: false } },
        { createdByDisplayName: "" },
        { createdByDisplayName: null },
        { $expr: { $eq: ["$createdByDisplayName", "$createdBy"] } },
        { createdByEmail: { $exists: false } },
        { createdByEmail: "" },
        { createdByEmail: null },
      ],
    };

    let cursor = skills.find(needle).project<SkillRow>({
      _id: 1,
      guid: 1,
      name: 1,
      createdBy: 1,
      createdByEmail: 1,
      createdByDisplayName: 1,
    });
    if (cfg.limit !== null) cursor = cursor.limit(cfg.limit);
    const targets = await cursor.toArray();

    if (targets.length === 0) {
      console.log("No skills need backfilling. Nothing to do.");
      return;
    }
    console.log(`Found ${targets.length} skills with missing / stale author labels.`);

    // Resolve all unique user_ids in one aggregate.
    const uniqueUserIds = [...new Set(targets.map((t) => t.createdBy as string))];
    const directoryRows = await activities
      .aggregate<DirectoryRow>([
        { $match: { userId: { $in: uniqueUserIds } } },
        {
          $group: {
            _id: "$userId",
            email: { $last: "$userEmail" },
            displayName: { $last: "$userDisplayName" },
          },
        },
      ])
      .toArray();
    const directory = new Map<string, DirectoryRow>();
    for (const r of directoryRows) directory.set(r._id, r);
    console.log(
      `Resolved ${directoryRows.length}/${uniqueUserIds.length} unique authors via the activities directory.`,
    );

    let updated = 0;
    let alreadyOk = 0;
    let unresolved = 0;
    for (const skill of targets) {
      const hit = directory.get(skill.createdBy as string);
      if (!hit) {
        unresolved++;
        continue;
      }
      const nextEmail = hit.email || "";
      const nextDisplay = hit.displayName || hit.email || "";
      // No-op when the cache already matches what the directory has —
      // keeps the run idempotent and the updated count honest.
      if (
        skill.createdByEmail === nextEmail &&
        skill.createdByDisplayName === nextDisplay
      ) {
        alreadyOk++;
        continue;
      }
      if (cfg.dryRun) {
        console.log(
          `[dry-run] ${skill.guid ?? skill._id} (${skill.name ?? "<no name>"}): ` +
            `createdBy=${skill.createdBy} → email='${nextEmail}', displayName='${nextDisplay}'`,
        );
        updated++;
        continue;
      }
      await skills.updateOne(
        { _id: skill._id },
        {
          $set: {
            createdByEmail: nextEmail,
            createdByDisplayName: nextDisplay,
          },
        },
      );
      updated++;
    }

    console.log(
      `\nDone. updated=${updated} alreadyOk=${alreadyOk} unresolved=${unresolved}` +
        (cfg.dryRun ? " (dry-run; nothing written)" : ""),
    );
    if (unresolved > 0) {
      console.log(
        `${unresolved} skill(s) had a createdBy with no matching activity row — author never logged into Ornn. Left untouched.`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
