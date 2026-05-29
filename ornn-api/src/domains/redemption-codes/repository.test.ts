/**
 * RedemptionCodeRepository unit tests (#454).
 *
 * Lifecycle pivots (`active → redeemed` and `active → invalidated`) MUST
 * be atomic — concurrent attempts against the same code yield exactly
 * one winner. The repo enforces this via `findOneAndUpdate` with a
 * status-guard filter; these tests pin that contract.
 *
 * Also covers list/search regex escaping (no ReDoS, no false positives)
 * and per-user redemption history pagination.
 *
 * @module domains/redemption-codes/repository.test
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
import { RedemptionCodeRepository } from "./repository";
import type { ActorMeta, RedemptionCodeDoc } from "./types";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: RedemptionCodeRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("redemption_codes_test");
  repo = new RedemptionCodeRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("redemption_codes").deleteMany({});
});

const admin: ActorMeta = { userId: "admin-1", email: "admin@x", displayName: "Admin" };
const user: ActorMeta = { userId: "u1", email: "u1@x", displayName: "User 1" };

function mkCode(overrides: Partial<RedemptionCodeDoc> = {}): RedemptionCodeDoc {
  const now = new Date();
  return {
    _id: `code-${Math.random().toString(36).slice(2)}`,
    code: `CODE${Math.floor(Math.random() * 1_000_000)}`,
    grants: [{ surface: "playground", amount: 100 }],
    note: undefined,
    createdAt: now,
    createdBy: admin,
    expiresAt: new Date(now.getTime() + 86_400_000), // +1 day
    status: "active",
    ...overrides,
  };
}

describe("insertCode + findByCode + findById", () => {
  test("round-trips a freshly minted code", async () => {
    const doc = mkCode({ code: "ABCDEFGH12345678" });
    await repo.insertCode(doc);
    const byCode = await repo.findByCode("ABCDEFGH12345678");
    expect(byCode?._id).toBe(doc._id);
    const byId = await repo.findById(doc._id);
    expect(byId?.code).toBe("ABCDEFGH12345678");
  });

  test("returns null for unknown code / id", async () => {
    expect(await repo.findByCode("NOPE")).toBeNull();
    expect(await repo.findById("missing")).toBeNull();
  });

  test("unique index rejects duplicate codes", async () => {
    await repo.insertCode(mkCode({ _id: "id-a", code: "DUPECODE12345678" }));
    await expect(
      repo.insertCode(mkCode({ _id: "id-b", code: "DUPECODE12345678" })),
    ).rejects.toThrow();
  });
});

describe("tryClaimForRedeem", () => {
  test("flips active → redeemed and stamps redeemer", async () => {
    const doc = mkCode({ code: "REDEEM0001" });
    await repo.insertCode(doc);
    const now = new Date();
    const after = await repo.tryClaimForRedeem({ code: doc.code, redeemedBy: user, now });
    expect(after?.status).toBe("redeemed");
    expect(after?.redeemedBy?.userId).toBe("u1");
    expect(after?.redeemedAt?.getTime()).toBe(now.getTime());
  });

  test("concurrent attempts on the same code yield exactly one winner", async () => {
    const doc = mkCode({ code: "RACECODE001" });
    await repo.insertCode(doc);
    const now = new Date();
    const results = await Promise.all([
      repo.tryClaimForRedeem({ code: doc.code, redeemedBy: user, now }),
      repo.tryClaimForRedeem({ code: doc.code, redeemedBy: user, now }),
      repo.tryClaimForRedeem({ code: doc.code, redeemedBy: user, now }),
    ]);
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
  });

  test("expired code cannot be redeemed", async () => {
    const expired = mkCode({
      code: "EXPIRED01",
      expiresAt: new Date(Date.now() - 1000),
    });
    await repo.insertCode(expired);
    const after = await repo.tryClaimForRedeem({
      code: expired.code,
      redeemedBy: user,
      now: new Date(),
    });
    expect(after).toBeNull();
    // Underlying state unchanged.
    const fresh = await repo.findByCode(expired.code);
    expect(fresh?.status).toBe("active");
  });

  test("invalidated code cannot be redeemed", async () => {
    const doc = mkCode({ code: "INVALID01", status: "invalidated" });
    await repo.insertCode(doc);
    const after = await repo.tryClaimForRedeem({
      code: doc.code,
      redeemedBy: user,
      now: new Date(),
    });
    expect(after).toBeNull();
  });

  test("unknown code yields null without inserting", async () => {
    const before = await db.collection("redemption_codes").countDocuments();
    const after = await repo.tryClaimForRedeem({
      code: "DOESNOTEXIST",
      redeemedBy: user,
      now: new Date(),
    });
    expect(after).toBeNull();
    expect(await db.collection("redemption_codes").countDocuments()).toBe(before);
  });
});

describe("tryInvalidate", () => {
  test("flips active → invalidated and stamps invalidator", async () => {
    const doc = mkCode();
    await repo.insertCode(doc);
    const now = new Date();
    const after = await repo.tryInvalidate({ id: doc._id, invalidatedBy: admin, now });
    expect(after?.status).toBe("invalidated");
    expect(after?.invalidatedBy?.userId).toBe("admin-1");
    expect(after?.invalidatedAt?.getTime()).toBe(now.getTime());
  });

  test("already-redeemed code cannot be invalidated", async () => {
    const doc = mkCode({ status: "redeemed" });
    await repo.insertCode(doc);
    const after = await repo.tryInvalidate({
      id: doc._id,
      invalidatedBy: admin,
      now: new Date(),
    });
    expect(after).toBeNull();
  });

  test("concurrent invalidates yield exactly one winner", async () => {
    const doc = mkCode();
    await repo.insertCode(doc);
    const now = new Date();
    const results = await Promise.all([
      repo.tryInvalidate({ id: doc._id, invalidatedBy: admin, now }),
      repo.tryInvalidate({ id: doc._id, invalidatedBy: admin, now }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("list", () => {
  beforeEach(async () => {
    // Seed: three active + one redeemed + one invalidated, with codes
    // and notes that exercise the search predicate.
    await repo.insertCode(
      mkCode({ _id: "a1", code: "AAAAAAAA00000001", note: "alpha team" }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await repo.insertCode(
      mkCode({ _id: "a2", code: "AAAAAAAA00000002", note: "alpha team" }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await repo.insertCode(
      mkCode({ _id: "b1", code: "BBBBBBBB00000001", note: "beta team" }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await repo.insertCode(
      mkCode({ _id: "r1", code: "REDEEMED00000001", status: "redeemed", note: "gamma" }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await repo.insertCode(
      mkCode({ _id: "i1", code: "INVALID000000001", status: "invalidated", note: "delta" }),
    );
  });

  test("filters by status", async () => {
    const res = await repo.list({ page: 1, pageSize: 20, status: "active" });
    expect(res.total).toBe(3);
    expect(res.items.every((d) => d.status === "active")).toBe(true);
  });

  test("paginates newest-first", async () => {
    const p1 = await repo.list({ page: 1, pageSize: 2 });
    const p2 = await repo.list({ page: 2, pageSize: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    // No overlap
    const ids1 = new Set(p1.items.map((d) => d._id));
    expect(p2.items.every((d) => !ids1.has(d._id))).toBe(true);
    // Sorted newest-first
    expect(p1.items[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(
      p1.items[1]!.createdAt.getTime(),
    );
  });

  test("search matches by code prefix (uppercased)", async () => {
    const res = await repo.list({ page: 1, pageSize: 20, search: "aaaa" });
    expect(res.total).toBe(2);
    expect(res.items.every((d) => d.code.startsWith("AAAA"))).toBe(true);
  });

  test("search matches by note substring (case-insensitive)", async () => {
    const res = await repo.list({ page: 1, pageSize: 20, search: "BETA" });
    expect(res.items.map((d) => d._id)).toEqual(["b1"]);
  });

  test("search escapes regex metacharacters (no ReDoS)", async () => {
    // `.*` would match everything if unescaped. The repo MUST treat it
    // as a literal string and return zero matches.
    const res = await repo.list({ page: 1, pageSize: 20, search: ".*" });
    expect(res.total).toBe(0);
  });

  test("empty search is a no-op (returns all)", async () => {
    const res = await repo.list({ page: 1, pageSize: 20, search: "   " });
    expect(res.total).toBe(5);
  });
});

describe("listRedeemedByUser", () => {
  test("returns only codes redeemed by the given userId, newest first", async () => {
    const now = new Date();
    await repo.insertCode(
      mkCode({
        _id: "ru1",
        code: "USERREDEEM0001",
        status: "redeemed",
        redeemedBy: user,
        redeemedAt: new Date(now.getTime() - 1000),
      }),
    );
    await repo.insertCode(
      mkCode({
        _id: "ru2",
        code: "USERREDEEM0002",
        status: "redeemed",
        redeemedBy: user,
        redeemedAt: now,
      }),
    );
    await repo.insertCode(
      mkCode({
        _id: "ru3",
        code: "OTHERUSER000001",
        status: "redeemed",
        redeemedBy: { userId: "u2", email: "u2@x", displayName: "U2" },
        redeemedAt: now,
      }),
    );
    const res = await repo.listRedeemedByUser("u1", 1, 10);
    expect(res.total).toBe(2);
    expect(res.items.map((d) => d._id)).toEqual(["ru2", "ru1"]);
  });

  test("returns empty when user has no redemptions", async () => {
    const res = await repo.listRedeemedByUser("nobody", 1, 10);
    expect(res).toEqual({ items: [], total: 0 });
  });

  test("respects pagination", async () => {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await repo.insertCode(
        mkCode({
          _id: `p${i}`,
          code: `PAGE${i.toString().padStart(12, "0")}`,
          status: "redeemed",
          redeemedBy: user,
          redeemedAt: new Date(now.getTime() - i * 1000),
        }),
      );
    }
    const p1 = await repo.listRedeemedByUser("u1", 1, 2);
    const p2 = await repo.listRedeemedByUser("u1", 2, 2);
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    const ids1 = new Set(p1.items.map((d) => d._id));
    expect(p2.items.every((d) => !ids1.has(d._id))).toBe(true);
  });
});
