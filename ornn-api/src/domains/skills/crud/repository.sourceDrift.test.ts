/**
 * Repository tests for the source-drift query + setter (#1176), against a
 * real in-memory MongoDB so the `$not`-regex query, the partial index, and
 * the dot-path `$set` are exercised for real.
 *
 * @module domains/skills/crud/repository.sourceDrift.test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SkillRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: SkillRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("source_drift_test");
  repo = new SkillRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
});

function skillDoc(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = new Date();
  return {
    name: `s-${overrides._id}`,
    description: "d",
    metadata: { category: "plain" },
    skillHash: "h",
    storageKey: "k",
    createdBy: "owner",
    createdOn: now,
    updatedBy: "owner",
    updatedOn: now,
    isPrivate: true,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  };
}

async function seed(...docs: Array<Record<string, unknown>>): Promise<void> {
  await db.collection("skills").insertMany(docs.map(skillDoc) as never);
}

describe("findGithubSourcedSkills", () => {
  test("selects due github skills only; excludes fresh, pinned, and source-less", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await seed(
      // github, never checked → included
      { _id: "g1", createdBy: "owner-1", source: { type: "github", repo: "a/x", ref: "main", path: "" } },
      // github, checked long ago → included
      {
        _id: "g2",
        createdBy: "owner-2",
        source: { type: "github", repo: "a/x", ref: "main", path: "", lastCheckedAt: threeHoursAgo },
      },
      // github, checked just now → excluded (fresh)
      {
        _id: "g3",
        createdBy: "owner-3",
        source: { type: "github", repo: "b/y", ref: "main", path: "", lastCheckedAt: new Date() },
      },
      // pinned 40-hex ref → excluded (never drifts)
      { _id: "g4", createdBy: "owner-4", source: { type: "github", repo: "c/z", ref: "a".repeat(40), path: "" } },
      // hand-uploaded (no source) → excluded
      { _id: "g5", createdBy: "owner-5" },
    );

    const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const due = await repo.findGithubSourcedSkills({ notCheckedSince: cutoff });

    expect(due.map((d) => d.guid).sort()).toEqual(["g1", "g2"]);
    const g1 = due.find((d) => d.guid === "g1")!;
    expect(g1.ownerId).toBe("owner-1");
    expect(g1.source.repo).toBe("a/x");
    expect(g1.source.ref).toBe("main");
  });
});

describe("updateSourceDriftState", () => {
  test("sets only drift dot-paths; preserves lastSyncedCommit and does NOT bump updatedOn", async () => {
    const created = new Date("2026-06-01T00:00:00.000Z");
    await seed({
      _id: "g1",
      updatedOn: created,
      updatedBy: "orig",
      source: { type: "github", repo: "a/x", ref: "main", path: "", lastSyncedCommit: "keepme" },
    });

    const checkedAt = new Date("2026-07-01T08:00:00.000Z");
    await repo.updateSourceDriftState("g1", {
      driftState: "drifted",
      upstreamHeadSha: "newsha",
      etag: 'W/"e1"',
      lastCheckedAt: checkedAt,
    });

    const doc = await repo.findByGuid("g1");
    expect(doc).not.toBeNull();
    const src = doc!.source!;
    expect(src.driftState).toBe("drifted");
    expect(src.upstreamHeadSha).toBe("newsha");
    expect(src.etag).toBe('W/"e1"');
    expect(src.lastCheckedAt?.toISOString()).toBe(checkedAt.toISOString());
    // Load-bearing: the refresh-owned field is untouched, and a background
    // drift check must not disturb sort-by-updated ordering.
    expect(src.lastSyncedCommit).toBe("keepme");
    expect(doc!.updatedOn.toISOString()).toBe(created.toISOString());
    expect(doc!.updatedBy).toBe("orig");
  });

  test("is a no-op on a skill with no source", async () => {
    await seed({ _id: "g1" }); // no source
    await repo.updateSourceDriftState("g1", { driftState: "broken", lastCheckedAt: new Date() });
    const doc = await repo.findByGuid("g1");
    expect(doc!.source).toBeUndefined();
  });
});
