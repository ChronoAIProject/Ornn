/**
 * Integration tests for the skill author-label backfill script.
 *
 * The script is a self-contained CLI (no exported entry point), so the
 * tests spawn it as a child process with `MONGODB_URI` pointed at a
 * `mongodb-memory-server` instance, then assert on side effects + stdout.
 *
 * Three scenarios:
 *   1. `--dry-run` against a fixture with stale labels — must NOT mutate.
 *   2. Live run against the same fixture — writes the correct labels.
 *   3. Live re-run on already-good rows — idempotent (no further writes).
 *
 * @module scripts/backfill-skill-author-display-names.test
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT_PATH = resolve(__dirname, "backfill-skill-author-display-names.ts");
const TEST_DB = "backfill-test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let mongoUri: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  mongoUri = mongo.getUri();
  client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(TEST_DB);
});

afterAll(async () => {
  await client.close().catch(() => {});
  await mongo.stop().catch(() => {});
});

beforeEach(async () => {
  await db.collection("skills").deleteMany({});
  await db.collection("activities").deleteMany({});
});

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the backfill script as a child process. */
function runScript(args: string[] = []): RunResult {
  const r = spawnSync("bun", ["run", SCRIPT_PATH, ...args], {
    env: {
      ...process.env,
      MONGODB_URI: mongoUri,
      MONGODB_DB: TEST_DB,
    },
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

async function seedActivity(rows: Array<{
  userId: string;
  email: string;
  displayName: string;
  createdAt?: Date;
}>): Promise<void> {
  await db.collection("activities").insertMany(
    rows.map((r, i) => ({
      _id: `act-${i}-${Math.random()}`,
      userId: r.userId,
      userEmail: r.email,
      userDisplayName: r.displayName,
      action: "login",
      details: {},
      createdAt: r.createdAt ?? new Date(),
    })) as never,
  );
}

async function seedSkills(rows: Array<{
  _id: string;
  createdBy: string;
  createdByEmail?: string | null;
  createdByDisplayName?: string | null;
}>): Promise<void> {
  await db.collection("skills").insertMany(rows as never);
}

describe("backfill-skill-author-display-names script", () => {
  test("dryRun_DoesNotMutate_ButReportsWhatWouldChange", async () => {
    await seedActivity([
      {
        userId: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
      },
    ]);
    await seedSkills([
      {
        _id: "skill-1",
        createdBy: "user-1",
        // Missing both label fields — qualifies as a backfill target.
      },
    ]);

    const result = runScript(["--dry-run"]);
    expect(result.status).toBe(0);
    // The dry-run banner is part of the script's own output.
    expect(result.stdout).toContain("[dry-run]");
    expect(result.stdout).toContain("alice@example.com");

    // Verify nothing was actually written.
    const after = await db.collection("skills").findOne({ _id: "skill-1" } as never);
    expect(after?.createdByEmail).toBeUndefined();
    expect(after?.createdByDisplayName).toBeUndefined();
  });

  test("liveRun_FillsMissingLabelsFromActivities", async () => {
    await seedActivity([
      {
        userId: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
      },
    ]);
    await seedSkills([{ _id: "skill-1", createdBy: "user-1" }]);

    const result = runScript([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("updated=1");

    const after = await db.collection("skills").findOne({ _id: "skill-1" } as never);
    expect(after?.createdByEmail).toBe("alice@example.com");
    expect(after?.createdByDisplayName).toBe("Alice");
  });

  test("liveRun_ReplacesCachedValueEqualToUserId", async () => {
    // Symptom in the issue: UI showed the raw userId because the
    // cached field was set to the userId itself. Backfill must overwrite.
    // Note: the script's needle covers the displayName==userId case
    // explicitly, but only displayName (not email) — see the script's
    // $or block. Test what's actually claimed.
    await seedActivity([
      {
        userId: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
      },
    ]);
    await seedSkills([
      {
        _id: "skill-1",
        createdBy: "user-1",
        createdByEmail: "alice@example.com",
        createdByDisplayName: "user-1", // poisoned: equals raw userId
      },
    ]);

    const result = runScript([]);
    expect(result.status).toBe(0);

    const after = await db.collection("skills").findOne({ _id: "skill-1" } as never);
    expect(after?.createdByDisplayName).toBe("Alice");
  });

  test("idempotent_RerunOnAlreadyBackfilledSkillIsNoop", async () => {
    await seedActivity([
      {
        userId: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
      },
    ]);
    await seedSkills([{ _id: "skill-1", createdBy: "user-1" }]);

    const first = runScript([]);
    expect(first.status).toBe(0);

    const second = runScript([]);
    expect(second.status).toBe(0);
    // Second run sees no candidates — script prints the early-out
    // banner instead of any updated=N line.
    expect(second.stdout).toContain("Nothing to do");
  });

  test("limitFlag_BoundsCandidateBatch", async () => {
    await seedActivity([
      { userId: "u1", email: "u1@example.com", displayName: "U1" },
      { userId: "u2", email: "u2@example.com", displayName: "U2" },
      { userId: "u3", email: "u3@example.com", displayName: "U3" },
    ]);
    await seedSkills([
      { _id: "s1", createdBy: "u1" },
      { _id: "s2", createdBy: "u2" },
      { _id: "s3", createdBy: "u3" },
    ]);

    const result = runScript(["--limit=2"]);
    expect(result.status).toBe(0);
    // Stdout reports the candidate count up front; --limit=2 trims to 2.
    expect(result.stdout).toContain("Found 2 skills");
  });

  test("unresolvedUser_LogsAndCounts_NoWrite", async () => {
    // Skill author has no rows in the activities collection at all.
    await seedSkills([{ _id: "skill-orphan", createdBy: "ghost" }]);

    const result = runScript([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("unresolved=1");

    const after = await db.collection("skills").findOne({ _id: "skill-orphan" } as never);
    expect(after?.createdByEmail).toBeUndefined();
    expect(after?.createdByDisplayName).toBeUndefined();
  });
});
