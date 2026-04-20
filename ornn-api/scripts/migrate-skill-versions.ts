/**
 * One-shot migration: backfill the `skill_versions` collection for every
 * existing skill in `skills` that predates the versioning feature.
 *
 * Behaviour:
 *   - If the skill doc has a valid `latestVersion` field, use it. Otherwise
 *     inspect `metadata.version` (legacy location); otherwise default to "0.1".
 *   - If a matching row (skillGuid + version) already exists in
 *     `skill_versions`, skip.
 *   - Otherwise insert one, referencing the skill's current `storageKey` so
 *     the pre-existing package is reachable through the versioned read path
 *     without re-uploading.
 *   - Ensure the skill doc itself carries `latestVersion` for the fast
 *     default-read path.
 *
 * Idempotent: running twice on a migrated DB is a no-op.
 *
 * Run with:
 *     bun run migrate:versions
 *
 * Reads the same MongoDB config as the API (`MONGODB_URI`, `MONGODB_DB`).
 */

import { MongoClient } from "mongodb";
import { SKILL_VERSION_REGEX } from "../src/shared/schemas/skillFrontmatter";

function readMongoConfig(): { uri: string; dbName: string } {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required");
  }
  return { uri, dbName: process.env.MONGODB_DB ?? "ornn" };
}

const DEFAULT_VERSION = "0.1";

function resolveVersion(skillDoc: Record<string, unknown>): string {
  const candidates: unknown[] = [
    skillDoc.latestVersion,
    (skillDoc.metadata as Record<string, unknown> | undefined)?.version,
    (skillDoc as { version?: unknown }).version,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && SKILL_VERSION_REGEX.test(raw)) {
      return raw;
    }
  }
  return DEFAULT_VERSION;
}

function parseMajorMinor(version: string): { major: number; minor: number } {
  const match = version.match(SKILL_VERSION_REGEX);
  if (!match) {
    throw new Error(`Unreachable — resolveVersion already validated: ${version}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]) };
}

async function main(): Promise<void> {
  const { uri, dbName } = readMongoConfig();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const skills = db.collection("skills");
  const skillVersions = db.collection("skill_versions");

  // Make sure the same index the app relies on exists before we write.
  await skillVersions.createIndex(
    { skillGuid: 1, majorVersion: -1, minorVersion: -1 },
    { name: "skill_versions_latest_lookup" },
  );

  const cursor = skills.find({});
  let scanned = 0;
  let inserted = 0;
  let skipped = 0;
  let backfilledLatestVersion = 0;

  for await (const skill of cursor) {
    scanned += 1;
    const guid = skill._id as unknown as string;
    const version = resolveVersion(skill);

    // Backfill `latestVersion` on the skill doc when absent/invalid.
    if (typeof skill.latestVersion !== "string" || !SKILL_VERSION_REGEX.test(skill.latestVersion)) {
      await skills.updateOne({ _id: skill._id }, { $set: { latestVersion: version } });
      backfilledLatestVersion += 1;
    }

    const versionId = `${guid}@${version}`;
    const existing = await skillVersions.findOne({ _id: versionId as never });
    if (existing) {
      skipped += 1;
      continue;
    }

    const { major, minor } = parseMajorMinor(version);

    await skillVersions.insertOne({
      _id: versionId as never,
      skillGuid: guid,
      version,
      majorVersion: major,
      minorVersion: minor,
      storageKey: skill.storageKey ?? skill.s3Url ?? "",
      skillHash: skill.skillHash ?? "",
      metadata: skill.metadata ?? { category: "plain" },
      license: skill.license ?? null,
      compatibility: skill.compatibility ?? null,
      createdBy: skill.createdBy ?? "",
      createdByEmail: skill.createdByEmail ?? null,
      createdByDisplayName: skill.createdByDisplayName ?? null,
      createdOn: skill.createdOn ?? new Date(),
    });
    inserted += 1;
  }

  console.log(
    `Skill versions migration complete — scanned=${scanned}, inserted=${inserted}, skipped=${skipped}, backfilledLatestVersion=${backfilledLatestVersion}`,
  );

  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
