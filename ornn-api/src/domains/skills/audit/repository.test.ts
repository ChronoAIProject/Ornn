/**
 * AuditRepository unit tests (#873).
 *
 * Backed by mongodb-memory-server (mirrors the notifications repository
 * test harness). The audit collection is append-only on insert
 * (`createRunning` mints a UUID `_id`) and updated in place on
 * complete/fail. Pins:
 *   - ensureIndexes resolves
 *   - createRunning persists a running placeholder + round-trips via mapDoc
 *   - markCompleted transitions running → completed (null on unknown id)
 *   - markFailed truncates errorMessage to 500 chars (null on unknown id)
 *   - findLatestBySkillAndVersion is newest-first incl. running rows
 *   - listBySkillGuid is newest-first across statuses
 *   - findLatestCompletedPerVersion is one-per-version, completed-only
 *   - findCachedByHash honours TTL + completed-only gate
 *
 * @module domains/skills/audit/repository.test
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AuditRepository, type CompleteAuditInput, type CreateRunningInput } from "./repository";
import type { AuditScore, AuditFinding } from "./types";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: AuditRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("audits_test");
  repo = new AuditRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skill_audits").deleteMany({});
});

// ---- Fixtures --------------------------------------------------------

function runningInput(overrides: Partial<CreateRunningInput> = {}): CreateRunningInput {
  return {
    skillGuid: "skill-1",
    version: "1.0.0",
    skillHash: "hash-abc",
    model: "gpt-test",
    triggeredBy: "user-1",
    ...overrides,
  };
}

const completedScores: AuditScore[] = [
  { dimension: "security", score: 9, rationale: "ok" },
  { dimension: "code_quality", score: 8, rationale: "ok" },
  { dimension: "documentation", score: 7, rationale: "ok" },
  { dimension: "reliability", score: 8, rationale: "ok" },
  { dimension: "permission_scope", score: 9, rationale: "ok" },
];

const completedFindings: AuditFinding[] = [
  { dimension: "security", severity: "warning", message: "watch out" },
];

const completeInput: CompleteAuditInput = {
  verdict: "green",
  overallScore: 8.2,
  scores: completedScores,
  findings: completedFindings,
};

/** Insert a running row, then force its createdAt so ordering is deterministic. */
async function seedAt(
  input: CreateRunningInput,
  createdAt: Date,
  patch: Record<string, unknown> = {},
): Promise<string> {
  const rec = await repo.createRunning(input);
  await db
    .collection("skill_audits")
    .updateOne({ _id: rec._id as never }, { $set: { createdAt, ...patch } });
  return rec._id;
}

describe("ensureIndexes", () => {
  test("resolves without throwing", async () => {
    await expect(repo.ensureIndexes()).resolves.toBeUndefined();
  });
});

describe("createRunning", () => {
  test("persists a running placeholder that round-trips through mapDoc", async () => {
    const rec = await repo.createRunning(runningInput());
    expect(rec.status).toBe("running");
    expect(rec.verdict).toBe("yellow"); // placeholder
    expect(rec.overallScore).toBe(0);
    expect(rec.scores).toEqual([]);
    expect(rec.findings).toEqual([]);
    expect(rec.model).toBe("gpt-test");
    expect(rec.triggeredBy).toBe("user-1");
    expect(rec.createdAt).toBeInstanceOf(Date);
    // _id is a UUID string, not an ObjectId.
    expect(rec._id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("markCompleted", () => {
  test("transitions running → completed and returns the mapped record", async () => {
    const running = await repo.createRunning(runningInput());
    const completed = await repo.markCompleted(running._id, completeInput);
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("completed");
    expect(completed!.verdict).toBe("green");
    expect(completed!.overallScore).toBe(8.2);
    expect(completed!.scores).toHaveLength(5);
    expect(completed!.findings).toHaveLength(1);
    expect(completed!.completedAt).toBeInstanceOf(Date);
  });

  test("returns null for an unknown id", async () => {
    expect(await repo.markCompleted("does-not-exist", completeInput)).toBeNull();
  });
});

describe("markFailed", () => {
  test("truncates errorMessage to 500 chars", async () => {
    const running = await repo.createRunning(runningInput());
    const longMessage = "x".repeat(600);
    const failed = await repo.markFailed(running._id, longMessage);
    expect(failed).not.toBeNull();
    expect(failed!.status).toBe("failed");
    expect(failed!.errorMessage).toBeDefined();
    expect(failed!.errorMessage!.length).toBe(500);
    expect(failed!.completedAt).toBeInstanceOf(Date);
  });

  test("returns null for an unknown id", async () => {
    expect(await repo.markFailed("does-not-exist", "boom")).toBeNull();
  });
});

describe("findLatestBySkillAndVersion", () => {
  test("returns the newest row, including running ones", async () => {
    await seedAt(runningInput(), new Date("2026-01-01T00:00:00Z"));
    const newerId = await seedAt(
      runningInput(),
      new Date("2026-02-01T00:00:00Z"),
    );
    const latest = await repo.findLatestBySkillAndVersion("skill-1", "1.0.0");
    expect(latest).not.toBeNull();
    expect(latest!._id).toBe(newerId);
    expect(latest!.status).toBe("running");
  });

  test("returns null when no record exists", async () => {
    expect(await repo.findLatestBySkillAndVersion("nope", "9.9.9")).toBeNull();
  });
});

describe("listBySkillGuid", () => {
  test("returns every status, newest first", async () => {
    const oldId = await seedAt(
      runningInput({ version: "1.0.0" }),
      new Date("2026-01-01T00:00:00Z"),
    );
    const midId = await seedAt(
      runningInput({ version: "1.1.0" }),
      new Date("2026-02-01T00:00:00Z"),
      { status: "failed", errorMessage: "boom" },
    );
    const newId = await seedAt(
      runningInput({ version: "1.2.0" }),
      new Date("2026-03-01T00:00:00Z"),
      { status: "completed" },
    );
    const rows = await repo.listBySkillGuid("skill-1");
    expect(rows.map((r) => r._id)).toEqual([newId, midId, oldId]);
    expect(rows.map((r) => r.status)).toEqual(["completed", "failed", "running"]);
  });
});

describe("findLatestCompletedPerVersion", () => {
  test("keeps one completed row per version and excludes running/failed", async () => {
    // version 1.0.0 — two completed; the newer wins.
    await seedAt(
      runningInput({ version: "1.0.0" }),
      new Date("2026-01-01T00:00:00Z"),
      { status: "completed", overallScore: 5 },
    );
    const v100Newer = await seedAt(
      runningInput({ version: "1.0.0" }),
      new Date("2026-02-01T00:00:00Z"),
      { status: "completed", overallScore: 9 },
    );
    // version 2.0.0 — only running + failed → excluded entirely.
    await seedAt(
      runningInput({ version: "2.0.0" }),
      new Date("2026-02-15T00:00:00Z"),
    );
    await seedAt(
      runningInput({ version: "2.0.0" }),
      new Date("2026-02-16T00:00:00Z"),
      { status: "failed" },
    );
    // version 3.0.0 — one completed.
    const v300 = await seedAt(
      runningInput({ version: "3.0.0" }),
      new Date("2026-03-01T00:00:00Z"),
      { status: "completed" },
    );

    const rows = await repo.findLatestCompletedPerVersion("skill-1");
    const byVersion = Object.fromEntries(rows.map((r) => [r.version, r]));
    expect(Object.keys(byVersion).sort()).toEqual(["1.0.0", "3.0.0"]);
    expect(byVersion["1.0.0"]!._id).toBe(v100Newer);
    expect(byVersion["1.0.0"]!.overallScore).toBe(9);
    expect(byVersion["3.0.0"]!._id).toBe(v300);
    expect(byVersion["2.0.0"]).toBeUndefined();
  });
});

describe("findCachedByHash", () => {
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days

  test("hits a completed row inside the TTL", async () => {
    const recent = new Date(Date.now() - 60_000); // 1 min ago
    const id = await seedAt(runningInput(), recent, { status: "completed" });
    const hit = await repo.findCachedByHash("skill-1", "hash-abc", maxAgeMs);
    expect(hit).not.toBeNull();
    expect(hit!._id).toBe(id);
  });

  test("misses when the only matching row is older than maxAgeMs", async () => {
    const stale = new Date(Date.now() - maxAgeMs - 60_000);
    await seedAt(runningInput(), stale, { status: "completed" });
    expect(await repo.findCachedByHash("skill-1", "hash-abc", maxAgeMs)).toBeNull();
  });

  test("misses when the matching row is not completed", async () => {
    const recent = new Date(Date.now() - 60_000);
    await seedAt(runningInput(), recent); // status stays running
    expect(await repo.findCachedByHash("skill-1", "hash-abc", maxAgeMs)).toBeNull();
  });
});
