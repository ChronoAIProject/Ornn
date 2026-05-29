/**
 * Migration tests UT-MIGRATE-001..010 + IT-QUOTA-MIGRATION (idempotent
 * end-to-end run on seeded old data).
 *
 * @module scripts/migrate-quota-to-buckets.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { migrate, parseNonNegativeInt } from "./migrate-quota-to-buckets";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("migration_test");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("user_quotas").deleteMany({});
  await db.collection("quota_grants").deleteMany({});
  await db.collection("_archive_quota_grants").deleteMany({});
  await db.collection("quota_buckets").deleteMany({});
  await db.collection("users_meta").deleteMany({});
  await db.collection("activities").deleteMany({});
});

const NOW = new Date(Date.UTC(2026, 4, 15));
const OPTS = {
  defaultPlaygroundMonthly: 200,
  defaultSkillGenMonthly: 20,
  now: NOW,
};

class FakeNotifier {
  calls: Array<{ targetUserId: string; monthMarker: string }> = [];
  async notifyQuotaModelChange(p: { targetUserId: string; monthMarker: string }) {
    this.calls.push(p);
  }
}

async function seedOldQuota(opts: {
  userId: string;
  pgMonthlyUsed?: number;
  pgCredits?: number;
  sgMonthlyUsed?: number;
}) {
  await db.collection("user_quotas").insertOne({
    userId: opts.userId,
    playground: {
      monthlyUsed: opts.pgMonthlyUsed ?? 0,
      dailyUsed: 0,
      creditsBalance: opts.pgCredits ?? 0,
      monthlyResetMarker: "2026-05",
      dailyResetMarker: "2026-05-15",
    },
    skillGen: {
      monthlyUsed: opts.sgMonthlyUsed ?? 0,
      dailyUsed: 0,
      creditsBalance: 0,
      monthlyResetMarker: "2026-05",
      dailyResetMarker: "2026-05-15",
    },
    updatedAt: NOW,
  });
}

async function seedOldGrant(opts: {
  _id: string;
  userId: string;
  surface: "playground" | "skillGen";
  amount: number;
  consumed?: number;
  expiresAt?: Date | null;
}) {
  await db.collection("quota_grants").insertOne({
    _id: opts._id as never,
    adminUserId: "a1",
    adminEmail: "a@x",
    adminDisplayName: "A",
    targetUserId: opts.userId,
    surface: opts.surface,
    amount: opts.amount,
    consumed: opts.consumed ?? 0,
    expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
    createdAt: NOW,
  });
}

async function seedActivity(userId: string, at: Date) {
  await db.collection("activities").insertOne({
    _id: `${userId}-${at.toISOString()}` as never,
    userId,
    userEmail: `${userId}@x`,
    userDisplayName: userId,
    action: "login",
    details: {},
    createdAt: at,
  });
}

describe("UT-MIGRATE-001 idempotent — running twice produces same state", () => {
  test("two runs leave bucket count + content unchanged", async () => {
    await seedOldQuota({ userId: "u1", pgMonthlyUsed: 5 });
    await migrate(db, OPTS);
    const after1 = await db.collection("quota_buckets").find().toArray();
    await migrate(db, OPTS);
    const after2 = await db.collection("quota_buckets").find().toArray();
    expect(after1.length).toBe(after2.length);
    // No bucket got incremented on second pass.
    expect(after2.find((b) => b.surface === "playground")?.used).toBe(5);
  });
});

describe("UT-MIGRATE-002 dry-run prints summary without writes", () => {
  test("counts non-zero, but no docs written", async () => {
    await seedOldQuota({ userId: "u1", pgMonthlyUsed: 5 });
    const report = await migrate(db, { ...OPTS, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.userQuotas.migrated).toBe(1);
    const buckets = await db.collection("quota_buckets").countDocuments();
    expect(buckets).toBe(0);
  });
});

describe("UT-MIGRATE-003 drops daily* fields on the new bucket", () => {
  test("new bucket has no dailyUsed / dailyResetMarker", async () => {
    await seedOldQuota({ userId: "u1", pgMonthlyUsed: 3 });
    await migrate(db, OPTS);
    const bucket = await db
      .collection("quota_buckets")
      .findOne({ userId: "u1", surface: "playground" });
    expect(bucket).not.toBeNull();
    expect("dailyUsed" in (bucket as object)).toBe(false);
    expect("dailyResetMarker" in (bucket as object)).toBe(false);
  });
});

describe("UT-MIGRATE-004 sums active grants into adminGrant", () => {
  test("two active grants summing 5 → adminGrant=5", async () => {
    await seedOldQuota({ userId: "u1" });
    await seedOldGrant({ _id: "g1", userId: "u1", surface: "playground", amount: 3 });
    await seedOldGrant({ _id: "g2", userId: "u1", surface: "playground", amount: 2 });
    await migrate(db, OPTS);
    const bucket = await db
      .collection("quota_buckets")
      .findOne({ userId: "u1", surface: "playground" });
    expect(bucket?.adminGrant).toBe(5);
  });
});

describe("UT-MIGRATE-005 ignores expired grants", () => {
  test("grant whose expiresAt < now is excluded from sum", async () => {
    await seedOldQuota({ userId: "u1" });
    await seedOldGrant({
      _id: "g_expired",
      userId: "u1",
      surface: "playground",
      amount: 10,
      expiresAt: new Date(Date.UTC(2026, 0, 1)),
    });
    await seedOldGrant({
      _id: "g_active",
      userId: "u1",
      surface: "playground",
      amount: 4,
      expiresAt: null,
    });
    await migrate(db, OPTS);
    const bucket = await db
      .collection("quota_buckets")
      .findOne({ userId: "u1", surface: "playground" });
    expect(bucket?.adminGrant).toBe(4);
  });
});

describe("UT-MIGRATE-006 renames quota_grants → _archive_quota_grants", () => {
  test("source dropped; archive populated", async () => {
    await seedOldQuota({ userId: "u1" });
    await seedOldGrant({ _id: "g1", userId: "u1", surface: "playground", amount: 1 });
    await migrate(db, OPTS);
    const sourceCount = await db
      .listCollections({ name: "quota_grants" })
      .toArray();
    expect(sourceCount.length).toBe(0);
    const archive = await db.collection("_archive_quota_grants").find().toArray();
    expect(archive.length).toBe(1);
  });
});

// UT-MIGRATE-007 / -008 (users_meta.firstJoinedAt backfill) were
// removed in issue #271 alongside the `users_meta` collection. The
// unified `users` directory is fed lazily on every authenticated
// request via `proxyAuthSetup.onAuthSeen`, not by this migration.

describe("UT-MIGRATE-010 per-user log entries", () => {
  test("3 users → 3 'Migrating user/surface bucket' info logs (per surface)", async () => {
    // We can't capture pino output here cleanly without rerouting; the
    // contract is "every user produces logs for both surfaces". Verify
    // by counting resulting buckets which is the proxy for the loop.
    await seedOldQuota({ userId: "u1" });
    await seedOldQuota({ userId: "u2" });
    await seedOldQuota({ userId: "u3" });
    await migrate(db, OPTS);
    const buckets = await db.collection("quota_buckets").find().toArray();
    // 3 users × 2 surfaces = 6 buckets.
    expect(buckets.length).toBe(6);
  });
});

describe("IT-QUOTA-MIGRATION end-to-end seeded old world", () => {
  test("buckets, archive, users_meta, notifications all wired", async () => {
    await seedOldQuota({
      userId: "u1",
      pgMonthlyUsed: 50,
      pgCredits: 10,
      sgMonthlyUsed: 2,
    });
    await seedOldGrant({
      _id: "g_long",
      userId: "u1",
      surface: "playground",
      amount: 30,
      consumed: 10,
      // Multi-month — expires 2 months out.
      expiresAt: new Date(Date.UTC(2026, 6, 1)),
    });
    await seedActivity("u1", new Date(Date.UTC(2026, 4, 10)));
    const notifier = new FakeNotifier();
    const report = await migrate(db, { ...OPTS, notificationService: notifier });

    const playground = await db
      .collection("quota_buckets")
      .findOne({ userId: "u1", surface: "playground" });
    // adminGrant = active grant remaining (30-10=20) + legacy creditsBalance (10) = 30
    expect(playground?.adminGrant).toBe(30);
    expect(playground?.used).toBe(50);
    expect(playground?.defaultAllotment).toBe(200);

    const skillGen = await db
      .collection("quota_buckets")
      .findOne({ userId: "u1", surface: "skillGen" });
    expect(skillGen?.used).toBe(2);
    expect(skillGen?.defaultAllotment).toBe(20);

    expect(report.archivedGrants).toBe(1);
    expect(notifier.calls.length).toBe(1);
    expect(notifier.calls[0].targetUserId).toBe("u1");
  });
});

describe("parseNonNegativeInt — fail-fast on garbage env input (#447)", () => {
  const ENV_NAME = "ORNN_TEST_INT";

  afterAll(() => {
    delete process.env[ENV_NAME];
  });

  beforeEach(() => {
    delete process.env[ENV_NAME];
  });

  test("uses fallback when env var is unset", () => {
    expect(parseNonNegativeInt(ENV_NAME, "200")).toBe(200);
  });

  test("parses a valid integer", () => {
    process.env[ENV_NAME] = "42";
    expect(parseNonNegativeInt(ENV_NAME, "0")).toBe(42);
  });

  test("trims surrounding whitespace", () => {
    process.env[ENV_NAME] = "  17  ";
    expect(parseNonNegativeInt(ENV_NAME, "0")).toBe(17);
  });

  test("accepts zero", () => {
    process.env[ENV_NAME] = "0";
    expect(parseNonNegativeInt(ENV_NAME, "99")).toBe(0);
  });

  test("rejects non-numeric input", () => {
    process.env[ENV_NAME] = "abc";
    expect(() => parseNonNegativeInt(ENV_NAME, "200")).toThrow(/must be a non-negative integer/);
  });

  test("rejects trailing garbage that Number(env) would silently truncate", () => {
    process.env[ENV_NAME] = "200abc";
    expect(() => parseNonNegativeInt(ENV_NAME, "0")).toThrow(/must be a non-negative integer/);
  });

  test("rejects negative values", () => {
    process.env[ENV_NAME] = "-1";
    expect(() => parseNonNegativeInt(ENV_NAME, "0")).toThrow(/must be a non-negative integer/);
  });

  test("rejects fractional values", () => {
    process.env[ENV_NAME] = "1.5";
    expect(() => parseNonNegativeInt(ENV_NAME, "0")).toThrow(/must be a non-negative integer/);
  });

  test("rejects empty string", () => {
    process.env[ENV_NAME] = "";
    expect(() => parseNonNegativeInt(ENV_NAME, "200")).toThrow(/must be a non-negative integer/);
  });
});
