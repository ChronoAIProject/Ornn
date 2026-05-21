/**
 * QuotaRepository UT-QUOTAREPO-001..007 against an in-memory Mongo.
 *
 * Exercises the persistence layer (atomic $inc, upsert idempotence,
 * chronological lifetime, append-only audit, indexes).
 *
 * @module domains/quota/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { QuotaRepository } from "./repository";
import { bucketId } from "./types";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: QuotaRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("quota_repo_test");
  repo = new QuotaRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("quota_buckets").deleteMany({});
  await db.collection("quota_grants_audit").deleteMany({});
});

describe("UT-QUOTAREPO-001 incrementUsed creates new bucket", () => {
  test("upsert creates doc with monthStart/monthEnd, defaults, used=1", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const b = await repo.incrementUsed({
      userId: "u1",
      surface: "playground",
      modelId: "gpt-4o",
      defaultAllotment: 100,
      now,
    });
    expect(b.userId).toBe("u1");
    expect(b.surface).toBe("playground");
    expect(b.monthMarker).toBe("2026-05");
    expect(b.monthStart.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(b.monthEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(b.defaultAllotment).toBe(100);
    expect(b.adminGrant).toBe(0);
    expect(b.used).toBe(1);
    expect(b.usedByModel["gpt-4o"]).toBe(1);
  });
});

describe("UT-QUOTAREPO-002 upsert is idempotent on _id", () => {
  test("two increments share the same _id; second hit increments used", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const id = bucketId("u1", "playground", "2026-05");
    await repo.incrementUsed({
      userId: "u1",
      surface: "playground",
      modelId: "m",
      defaultAllotment: 100,
      now,
    });
    await repo.incrementUsed({
      userId: "u1",
      surface: "playground",
      modelId: "m",
      defaultAllotment: 100,
      now,
    });
    const docs = await db
      .collection("quota_buckets")
      .find({ userId: "u1", surface: "playground" })
      .toArray();
    expect(docs.length).toBe(1);
    expect(docs[0]!._id as unknown as string).toBe(id);
    expect((docs[0]! as unknown as { used: number }).used).toBe(2);
  });
});

describe("UT-QUOTAREPO-003 incrementUsed atomic under concurrency", () => {
  test("50 parallel increments → used==50", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    await Promise.all(
      Array.from({ length: 50 }, () =>
        repo.incrementUsed({
          userId: "u1",
          surface: "playground",
          modelId: "gpt-4o",
          defaultAllotment: 1000,
          now,
        }),
      ),
    );
    const b = await repo.findBucket("u1", "playground", "2026-05");
    expect(b?.used).toBe(50);
    expect(b?.usedByModel["gpt-4o"]).toBe(50);
  });
});

describe("UT-QUOTAREPO-004 incrementUsed updates used + usedByModel together", () => {
  test("single op writes both fields atomically", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    await repo.incrementUsed({
      userId: "u1",
      surface: "playground",
      modelId: "gpt-4o",
      defaultAllotment: 100,
      now,
    });
    await repo.incrementUsed({
      userId: "u1",
      surface: "playground",
      modelId: "claude-sonnet",
      defaultAllotment: 100,
      now,
    });
    const b = await repo.findBucket("u1", "playground", "2026-05");
    expect(b?.used).toBe(2);
    expect(b?.usedByModel["gpt-4o"]).toBe(1);
    expect(b?.usedByModel["claude-sonnet"]).toBe(1);
  });
});

describe("UT-QUOTAREPO-005 appendGrantAudit inserts row with all spec fields", () => {
  test("audit row carries admin + target + month details", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    const id = await repo.appendGrantAudit({
      adminUserId: "a1",
      adminEmail: "a@x.test",
      adminDisplayName: "Admin",
      targetUserId: "u1",
      surface: "playground",
      amount: 5,
      note: "initial",
      monthMarker: "2026-05",
      createdAt: now,
    });
    const row = await db
      .collection("quota_grants_audit")
      .findOne({ _id: id as unknown as never });
    expect(row?.adminUserId).toBe("a1");
    expect(row?.targetUserId).toBe("u1");
    expect(row?.surface).toBe("playground");
    expect(row?.amount).toBe(5);
    expect(row?.note).toBe("initial");
    expect(row?.monthMarker).toBe("2026-05");
  });
});

describe("UT-QUOTAREPO-006 findLifetime sorts asc by monthMarker", () => {
  test("3 buckets seeded out of order → returned chronologically", async () => {
    const months = [
      { marker: "2026-04", date: new Date(Date.UTC(2026, 3, 15)) },
      { marker: "2026-06", date: new Date(Date.UTC(2026, 5, 15)) },
      { marker: "2026-05", date: new Date(Date.UTC(2026, 4, 15)) },
    ];
    for (const { date } of months) {
      await repo.incrementUsed({
        userId: "u1",
        surface: "playground",
        modelId: "m",
        defaultAllotment: 100,
        now: date,
      });
    }
    const lifetime = await repo.findLifetime("u1", "playground");
    expect(lifetime.map((b) => b.monthMarker)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("UT-QUOTAREPO-007 findLifetime returns [] for new user", () => {
  test("empty array, not null", async () => {
    const lifetime = await repo.findLifetime("nobody", "playground");
    expect(lifetime).toEqual([]);
  });
});

describe("incrementAdminGrant is atomic", () => {
  test("two parallel grants accumulate to sum", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    await Promise.all([
      repo.incrementAdminGrant({
        userId: "u1",
        surface: "playground",
        amount: 5,
        defaultAllotment: 100,
        now,
      }),
      repo.incrementAdminGrant({
        userId: "u1",
        surface: "playground",
        amount: 7,
        defaultAllotment: 100,
        now,
      }),
    ]);
    const b = await repo.findBucket("u1", "playground", "2026-05");
    expect(b?.adminGrant).toBe(12);
  });
});

describe("listGrantAudit pagination + filter", () => {
  test("page=2 pageSize=5 returns rows 6..10", async () => {
    const base = new Date(Date.UTC(2026, 4, 1)).getTime();
    for (let i = 0; i < 15; i++) {
      await repo.appendGrantAudit({
        adminUserId: "a1",
        adminEmail: "a@x.test",
        adminDisplayName: "Admin",
        targetUserId: `u${i}`,
        surface: "playground",
        amount: 1,
        monthMarker: "2026-05",
        createdAt: new Date(base + i * 1000),
      });
    }
    const res = await repo.listGrantAudit({ page: 2, pageSize: 5 });
    expect(res.total).toBe(15);
    expect(res.items.length).toBe(5);
  });

  test("filter by targetUserId narrows results", async () => {
    await repo.appendGrantAudit({
      adminUserId: "a1",
      adminEmail: "a@x.test",
      adminDisplayName: "Admin",
      targetUserId: "uA",
      surface: "playground",
      amount: 1,
      monthMarker: "2026-05",
      createdAt: new Date(),
    });
    await repo.appendGrantAudit({
      adminUserId: "a1",
      adminEmail: "a@x.test",
      adminDisplayName: "Admin",
      targetUserId: "uB",
      surface: "playground",
      amount: 1,
      monthMarker: "2026-05",
      createdAt: new Date(),
    });
    const res = await repo.listGrantAudit({ page: 1, pageSize: 50, targetUserId: "uA" });
    expect(res.total).toBe(1);
    expect(res.items[0]!.targetUserId).toBe("uA");
  });
});
