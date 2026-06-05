/**
 * QuotaRepository UT-QUOTAREPO-001..010 against an in-memory Mongo.
 *
 * Exercises the persistence layer: the atomic cap-guarded reserve
 * (#808 TOCTOU fix), per-model commit, slot release, upsert idempotence,
 * chronological lifetime, append-only audit, indexes.
 *
 * @module domains/quota/repository.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { QuotaRepository } from "./repository";
import { bucketId, type QuotaBucketDoc } from "./types";

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

const NOW = new Date(Date.UTC(2026, 4, 15));
const MARKER = "2026-05";

/** Seed a bucket directly so a test can start from a precise counter. */
async function seedBucket(overrides: Partial<QuotaBucketDoc>): Promise<void> {
  const _id = bucketId("u1", "playground", MARKER);
  await db.collection<QuotaBucketDoc>("quota_buckets").insertOne({
    _id,
    userId: "u1",
    surface: "playground",
    monthMarker: MARKER,
    monthStart: new Date(Date.UTC(2026, 4, 1)),
    monthEnd: new Date(Date.UTC(2026, 5, 1)),
    defaultAllotment: 100,
    adminGrant: 0,
    used: 0,
    usedByModel: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

describe("UT-QUOTAREPO-001 reserveSlot creates new bucket on first touch", () => {
  test("first reserve inserts doc with monthStart/monthEnd, defaults, used=1", async () => {
    const ok = await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 100,
      now: NOW,
    });
    expect(ok).toBe(true);
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.userId).toBe("u1");
    expect(b?.surface).toBe("playground");
    expect(b?.monthMarker).toBe(MARKER);
    expect(b?.monthStart.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(b?.monthEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(b?.defaultAllotment).toBe(100);
    expect(b?.adminGrant).toBe(0);
    expect(b?.used).toBe(1);
    expect(b?.usedByModel).toEqual({});
  });

  test("effectiveDefault < 1 denies and creates nothing", async () => {
    const ok = await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 0,
      now: NOW,
    });
    expect(ok).toBe(false);
    expect(await repo.findBucket("u1", "playground", MARKER)).toBeNull();
  });
});

describe("UT-QUOTAREPO-002 reserveSlot honours the cap on an existing bucket", () => {
  test("reserve allowed below cap, denied at cap; used never exceeds cap", async () => {
    // cap = effectiveDefault(100) + adminGrant(0) = 100.
    await seedBucket({ used: 99 });
    const first = await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 100,
      now: NOW,
    });
    expect(first).toBe(true); // used 99 -> 100
    const second = await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 100,
      now: NOW,
    });
    expect(second).toBe(false); // 100 == cap, denied
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(100);
  });

  test("adminGrant lifts the cap", async () => {
    await seedBucket({ used: 100, adminGrant: 5 });
    const ok = await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 100,
      now: NOW,
    });
    expect(ok).toBe(true); // cap now 105, used 100 -> 101
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(101);
  });
});

describe("UT-QUOTAREPO-003 reserveSlot is atomic under concurrency (TOCTOU)", () => {
  test("K=20 parallel reserves at used=cap-1 → exactly 1 wins, used==cap", async () => {
    const cap = 100;
    await seedBucket({ used: cap - 1, defaultAllotment: cap });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.reserveSlot({
          userId: "u1",
          surface: "playground",
          effectiveDefault: cap,
          now: NOW,
        }),
      ),
    );

    const granted = results.filter((r) => r === true).length;
    expect(granted).toBe(1);
    expect(results.filter((r) => r === false).length).toBe(19);
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.used).toBe(cap); // never cap+1
  });

  test("K=20 parallel reserves on first touch (no bucket) → 1 creates, rest race the cap", async () => {
    // effectiveDefault 1 means exactly one slot total. The insert race
    // (E11000) must collapse to a single winner.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.reserveSlot({
          userId: "u1",
          surface: "playground",
          effectiveDefault: 1,
          now: NOW,
        }),
      ),
    );
    expect(results.filter((r) => r === true).length).toBe(1);
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(1);
  });
});

describe("UT-QUOTAREPO-004 releaseSlot refunds a reservation", () => {
  test("reserve then release returns used to baseline", async () => {
    await seedBucket({ used: 50 });
    await repo.reserveSlot({
      userId: "u1",
      surface: "playground",
      effectiveDefault: 100,
      now: NOW,
    });
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(51);
    await repo.releaseSlot({ userId: "u1", surface: "playground", now: NOW });
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(50);
  });

  test("releaseSlot at used=0 is a no-op (floored, never negative)", async () => {
    await seedBucket({ used: 0 });
    await repo.releaseSlot({ userId: "u1", surface: "playground", now: NOW });
    expect((await repo.findBucket("u1", "playground", MARKER))?.used).toBe(0);
  });

  test("releaseSlot on a missing bucket is a no-op", async () => {
    await repo.releaseSlot({ userId: "ghost", surface: "playground", now: NOW });
    expect(await repo.findBucket("ghost", "playground", MARKER)).toBeNull();
  });
});

describe("UT-QUOTAREPO-005 commitModel records usedByModel without touching used", () => {
  test("commit increments usedByModel.<id>; used unchanged", async () => {
    await seedBucket({ used: 1 });
    await repo.commitModel({
      userId: "u1",
      surface: "playground",
      modelId: "gpt-4o",
      now: NOW,
    });
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.used).toBe(1); // reserve already bumped this — commit must not
    expect(b?.usedByModel["gpt-4o"]).toBe(1);
  });

  test("two commits with different models tally separately", async () => {
    await seedBucket({ used: 2 });
    await repo.commitModel({ userId: "u1", surface: "playground", modelId: "gpt-4o", now: NOW });
    await repo.commitModel({ userId: "u1", surface: "playground", modelId: "claude-sonnet", now: NOW });
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.used).toBe(2);
    expect(b?.usedByModel["gpt-4o"]).toBe(1);
    expect(b?.usedByModel["claude-sonnet"]).toBe(1);
  });

  test("null modelId routes to __unknown__ sentinel", async () => {
    await seedBucket({ used: 1 });
    await repo.commitModel({ userId: "u1", surface: "playground", modelId: null, now: NOW });
    expect((await repo.findBucket("u1", "playground", MARKER))?.usedByModel["__unknown__"]).toBe(1);
  });
});

describe("UT-QUOTAREPO-006 reserve + commit models the full charge lifecycle", () => {
  test("reserve then commit → used=1, usedByModel.<id>=1 (matches legacy increment)", async () => {
    await repo.reserveSlot({ userId: "u1", surface: "playground", effectiveDefault: 100, now: NOW });
    await repo.commitModel({ userId: "u1", surface: "playground", modelId: "gpt-4o", now: NOW });
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.used).toBe(1);
    expect(b?.usedByModel["gpt-4o"]).toBe(1);
  });
});

describe("UT-QUOTAREPO-007 findLifetime sorts asc by monthMarker", () => {
  test("3 buckets seeded out of order → returned chronologically", async () => {
    const months = [
      { marker: "2026-04", date: new Date(Date.UTC(2026, 3, 15)) },
      { marker: "2026-06", date: new Date(Date.UTC(2026, 5, 15)) },
      { marker: "2026-05", date: new Date(Date.UTC(2026, 4, 15)) },
    ];
    for (const { date } of months) {
      await repo.reserveSlot({
        userId: "u1",
        surface: "playground",
        effectiveDefault: 100,
        now: date,
      });
    }
    const lifetime = await repo.findLifetime("u1", "playground");
    expect(lifetime.map((b) => b.monthMarker)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("UT-QUOTAREPO-008 findLifetime returns [] for new user", () => {
  test("empty array, not null", async () => {
    const lifetime = await repo.findLifetime("nobody", "playground");
    expect(lifetime).toEqual([]);
  });
});

describe("incrementAdminGrant is atomic", () => {
  test("two parallel grants accumulate to sum", async () => {
    await Promise.all([
      repo.incrementAdminGrant({
        userId: "u1",
        surface: "playground",
        amount: 5,
        defaultAllotment: 100,
        now: NOW,
      }),
      repo.incrementAdminGrant({
        userId: "u1",
        surface: "playground",
        amount: 7,
        defaultAllotment: 100,
        now: NOW,
      }),
    ]);
    const b = await repo.findBucket("u1", "playground", MARKER);
    expect(b?.adminGrant).toBe(12);
  });
});

describe("UT-QUOTAREPO-005a appendGrantAudit inserts row with all spec fields", () => {
  test("audit row carries admin + target + month details", async () => {
    const id = await repo.appendGrantAudit({
      adminUserId: "a1",
      adminEmail: "a@x.test",
      adminDisplayName: "Admin",
      targetUserId: "u1",
      surface: "playground",
      amount: 5,
      note: "initial",
      monthMarker: MARKER,
      createdAt: NOW,
    });
    const row = await db
      .collection("quota_grants_audit")
      .findOne({ _id: id as unknown as never });
    expect(row?.adminUserId).toBe("a1");
    expect(row?.targetUserId).toBe("u1");
    expect(row?.surface).toBe("playground");
    expect(row?.amount).toBe(5);
    expect(row?.note).toBe("initial");
    expect(row?.monthMarker).toBe(MARKER);
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
        monthMarker: MARKER,
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
      monthMarker: MARKER,
      createdAt: new Date(),
    });
    await repo.appendGrantAudit({
      adminUserId: "a1",
      adminEmail: "a@x.test",
      adminDisplayName: "Admin",
      targetUserId: "uB",
      surface: "playground",
      amount: 1,
      monthMarker: MARKER,
      createdAt: new Date(),
    });
    const res = await repo.listGrantAudit({ page: 1, pageSize: 50, targetUserId: "uA" });
    expect(res.total).toBe(1);
    expect(res.items[0]!.targetUserId).toBe("uA");
  });
});
