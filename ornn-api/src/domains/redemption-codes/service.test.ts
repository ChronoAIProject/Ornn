/**
 * RedemptionCodeService — lifecycle, error branches, and the
 * parallel-redeem race that motivates `tryClaimForRedeem`.
 *
 * @module domains/redemption-codes/service.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { QuotaRepository } from "../quota/repository";
import { QuotaService } from "../quota/service";
import { RedemptionCodeRepository } from "./repository";
import { RedemptionCodeService } from "./service";
import type { ActorMeta } from "./types";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: RedemptionCodeRepository;
let quotaService: QuotaService;
let service: RedemptionCodeService;

const ADMIN: ActorMeta = {
  userId: "admin1",
  email: "admin@x.test",
  displayName: "Admin",
};
const REDEEMER: ActorMeta = {
  userId: "user1",
  email: "user@x.test",
  displayName: "User One",
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("redemption_codes_service_test");
  repo = new RedemptionCodeRepository(db);
  await repo.ensureIndexes();
  const quotaRepo = new QuotaRepository(db);
  await quotaRepo.ensureIndexes();
  quotaService = new QuotaService({
    repo: quotaRepo,
    defaults: {
      async getQuotaDefaults() {
        return { defaultPlaygroundMonthly: 100, defaultSkillGenMonthly: 10 };
      },
    },
  });
  service = new RedemptionCodeService({ repo, quotaService });
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("redemption_codes").deleteMany({});
  await db.collection("quota_buckets").deleteMany({});
  await db.collection("quota_grants_audit").deleteMany({});
});

function plusDays(n: number, base: Date = new Date()): Date {
  return new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
}

describe("RedemptionCodeService.mint", () => {
  test("produces unique 16-char code over restricted alphabet", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    expect(doc.code.length).toBe(16);
    expect(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(doc.code)).toBe(true);
    expect(doc.status).toBe("active");
    expect(doc.grants).toEqual([{ surface: "playground", amount: 5 }]);
    expect(doc.createdBy).toEqual(ADMIN);
  });

  test("rejects duplicate surface in grants", async () => {
    await expect(
      service.mint({
        admin: ADMIN,
        grants: [
          { surface: "playground", amount: 5 },
          { surface: "playground", amount: 7 },
        ],
        expiresAt: plusDays(1),
      }),
    ).rejects.toThrow(/duplicate surface/i);
  });

  test("rejects expiresAt in the past", async () => {
    await expect(
      service.mint({
        admin: ADMIN,
        grants: [{ surface: "playground", amount: 5 }],
        expiresAt: plusDays(-1),
      }),
    ).rejects.toThrow(/INVALID_EXPIRES_AT/);
  });
});

describe("RedemptionCodeService.redeem — happy path", () => {
  test("transitions code to redeemed and applies all grants", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [
        { surface: "playground", amount: 5 },
        { surface: "skillGen", amount: 3 },
      ],
      expiresAt: plusDays(7),
    });
    const result = await service.redeem({
      code: doc.code,
      redeemer: REDEEMER,
      permissions: [],
    });
    expect(result.code.status).toBe("redeemed");
    expect(result.code.redeemedBy).toEqual(REDEEMER);
    expect(result.appliedGrants.length).toBe(2);
    const surfaces = result.appliedGrants.map((g) => g.surface).sort();
    expect(surfaces).toEqual(["playground", "skillGen"]);
    const audits = await db.collection("quota_grants_audit").countDocuments();
    expect(audits).toBe(2);
  });
});

describe("RedemptionCodeService.redeem — race", () => {
  test("two parallel redemptions of the same code → exactly one wins", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    const a: ActorMeta = { userId: "uA", email: "a@x", displayName: "A" };
    const b: ActorMeta = { userId: "uB", email: "b@x", displayName: "B" };
    const results = await Promise.allSettled([
      service.redeem({ code: doc.code, redeemer: a, permissions: [] }),
      service.redeem({ code: doc.code, redeemer: b, permissions: [] }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as Error;
    expect(reason.message).toMatch(/ALREADY_REDEEMED/);
  });
});

describe("RedemptionCodeService.redeem — rejection branches", () => {
  test("expired code → EXPIRED:", async () => {
    const past = new Date(Date.now() - 1000);
    // mint with future expiry, then back-date via repo
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(1),
    });
    await repo.collection.updateOne(
      { _id: doc._id },
      { $set: { expiresAt: past } },
    );
    await expect(
      service.redeem({ code: doc.code, redeemer: REDEEMER, permissions: [] }),
    ).rejects.toThrow(/EXPIRED:/);
  });

  test("already-redeemed code → ALREADY_REDEEMED:", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.redeem({ code: doc.code, redeemer: REDEEMER, permissions: [] });
    await expect(
      service.redeem({ code: doc.code, redeemer: REDEEMER, permissions: [] }),
    ).rejects.toThrow(/ALREADY_REDEEMED/);
  });

  test("invalidated code → ALREADY_INVALIDATED:", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.invalidate({ id: doc._id, admin: ADMIN });
    await expect(
      service.redeem({ code: doc.code, redeemer: REDEEMER, permissions: [] }),
    ).rejects.toThrow(/ALREADY_INVALIDATED/);
  });

  test("unknown code → NOT_FOUND:", async () => {
    await expect(
      service.redeem({ code: "ZZZZZZZZZZZZZZZZ", redeemer: REDEEMER, permissions: [] }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe("RedemptionCodeService.invalidate", () => {
  test("active → invalidated", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    const updated = await service.invalidate({ id: doc._id, admin: ADMIN });
    expect(updated.status).toBe("invalidated");
    expect(updated.invalidatedBy).toEqual(ADMIN);
  });

  test("already-redeemed → ALREADY_REDEEMED:", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.redeem({ code: doc.code, redeemer: REDEEMER, permissions: [] });
    await expect(service.invalidate({ id: doc._id, admin: ADMIN })).rejects.toThrow(
      /ALREADY_REDEEMED/,
    );
  });

  test("already-invalidated → ALREADY_INVALIDATED:", async () => {
    const doc = await service.mint({
      admin: ADMIN,
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.invalidate({ id: doc._id, admin: ADMIN });
    await expect(service.invalidate({ id: doc._id, admin: ADMIN })).rejects.toThrow(
      /ALREADY_INVALIDATED/,
    );
  });

  test("unknown id → NOT_FOUND:", async () => {
    await expect(
      service.invalidate({ id: "ffffffffffffffffffffffff", admin: ADMIN }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
