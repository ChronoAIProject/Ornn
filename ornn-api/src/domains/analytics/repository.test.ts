/**
 * AnalyticsRepository unit tests (#454).
 *
 * Two collections: `skill_executions` (per-call events) and
 * `skill_pulls` (per-download events). Repo is fire-and-forget on
 * writes — never blocks a user's skill invocation. Reads aggregate
 * over rolling windows.
 *
 * Covers happy path + at least one edge per public method.
 *
 * @module domains/analytics/repository.test
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
import { AnalyticsRepository } from "./repository";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: AnalyticsRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("analytics_test");
  repo = new AnalyticsRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("skill_executions").deleteMany({});
  await db.collection("skill_pulls").deleteMany({});
});

describe("recordEvent", () => {
  test("inserts an execution event", async () => {
    await repo.recordEvent({
      skillGuid: "s1",
      skillName: "pdf-extract",
      skillVersion: "1.0",
      outcome: "success",
      latencyMs: 123.7,
      userId: "u1",
      source: "playground",
    });
    const doc = await db.collection("skill_executions").findOne({ skillGuid: "s1" });
    expect(doc?.skillName).toBe("pdf-extract");
    expect(doc?.outcome).toBe("success");
    // latencyMs is rounded to int
    expect(doc?.latencyMs).toBe(124);
    expect(doc?.createdAt).toBeInstanceOf(Date);
  });

  test("clamps negative latency to 0 (defensive)", async () => {
    await repo.recordEvent({
      skillGuid: "s1",
      skillName: "x",
      outcome: "success",
      latencyMs: -50,
      userId: "u1",
      source: "playground",
    });
    const doc = await db.collection("skill_executions").findOne({ skillGuid: "s1" });
    expect(doc?.latencyMs).toBe(0);
  });
});

describe("recordPull", () => {
  test("inserts a pull event into skill_pulls", async () => {
    await repo.recordPull({
      skillGuid: "s1",
      skillName: "pdf-extract",
      skillVersion: "1.0",
      userId: "u1",
      source: "api",
    });
    const doc = await db.collection("skill_pulls").findOne({ skillGuid: "s1" });
    expect(doc?.skillName).toBe("pdf-extract");
    expect(doc?.skillVersion).toBe("1.0");
    expect(doc?.source).toBe("api");
  });
});

describe("summarize", () => {
  beforeEach(async () => {
    // 3 successes + 1 failure + 1 timeout for skill s1
    for (let i = 0; i < 3; i++) {
      await repo.recordEvent({
        skillGuid: "s1",
        skillName: "x",
        skillVersion: "1.0",
        outcome: "success",
        latencyMs: 100,
        userId: `u${i}`,
        source: "playground",
      });
    }
    await repo.recordEvent({
      skillGuid: "s1",
      skillName: "x",
      skillVersion: "1.0",
      outcome: "failure",
      latencyMs: 50,
      userId: "u3",
      source: "playground",
      errorCode: "internal_error",
    });
    await repo.recordEvent({
      skillGuid: "s1",
      skillName: "x",
      skillVersion: "1.0",
      outcome: "timeout",
      latencyMs: 30000,
      userId: "u4",
      source: "playground",
    });
    // Separate skill — must NOT bleed into s1's aggregate
    await repo.recordEvent({
      skillGuid: "s2",
      skillName: "y",
      outcome: "success",
      latencyMs: 10,
      userId: "u1",
      source: "playground",
    });
  });

  test("aggregates execution counts, success rate, unique users", async () => {
    const summary = await repo.summarize("s1", "30d");
    expect(summary.executionCount).toBe(5);
    expect(summary.successCount).toBe(3);
    expect(summary.failureCount).toBe(1);
    expect(summary.timeoutCount).toBe(1);
    // success rate = 3/5 = 0.6
    expect(summary.successRate).toBeCloseTo(0.6, 2);
    expect(summary.uniqueUsers).toBe(5);
  });

  test("optional version filter narrows the aggregate", async () => {
    await repo.recordEvent({
      skillGuid: "s1",
      skillName: "x",
      skillVersion: "2.0",
      outcome: "success",
      latencyMs: 1,
      userId: "u9",
      source: "playground",
    });
    // Pull all 6, then narrowed to v1.0 only (5)
    const all = await repo.summarize("s1", "30d");
    expect(all.executionCount).toBe(6);
    const onlyV1 = await repo.summarize("s1", "30d", { version: "1.0" });
    expect(onlyV1.executionCount).toBe(5);
  });

  test("returns zeros for a skill with no events", async () => {
    const summary = await repo.summarize("does-not-exist", "30d");
    expect(summary.executionCount).toBe(0);
    expect(summary.successCount).toBe(0);
    expect(summary.successRate).toBeNull();
  });
});

describe("aggregatePullsByBucket", () => {
  test("returns hourly buckets when bucket=hour", async () => {
    for (let i = 0; i < 3; i++) {
      await repo.recordPull({
        skillGuid: "s1",
        skillName: "x",
        skillVersion: "1.0",
        userId: `u${i}`,
        source: "api",
      });
    }
    const series = await repo.aggregatePullsByBucket({
      skillGuid: "s1",
      bucket: "hour",
      // Default `to` is `new Date()` evaluated INSIDE the call, with
      // `$lt: to` — just-inserted events at exactly that timestamp
      // get excluded. Push the upper bound past any test-inserted
      // createdAt.
      to: new Date(Date.now() + 60_000),
    });
    const total = series.reduce((acc, b) => acc + b.total, 0);
    expect(total).toBe(3);
  });

  test("filters by version when set", async () => {
    await repo.recordPull({
      skillGuid: "s1",
      skillName: "x",
      skillVersion: "1.0",
      userId: "u1",
      source: "api",
    });
    await repo.recordPull({
      skillGuid: "s1",
      skillName: "x",
      skillVersion: "2.0",
      userId: "u2",
      source: "api",
    });
    const onlyV1 = await repo.aggregatePullsByBucket({
      skillGuid: "s1",
      bucket: "day",
      version: "1.0",
      to: new Date(Date.now() + 60_000),
    });
    const total = onlyV1.reduce((acc, b) => acc + b.total, 0);
    expect(total).toBe(1);
  });

  test("returns empty series for a skill with no pulls", async () => {
    const series = await repo.aggregatePullsByBucket({
      skillGuid: "does-not-exist",
      bucket: "day",
    });
    expect(series).toEqual([]);
  });
});
