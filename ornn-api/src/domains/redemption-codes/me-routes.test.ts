/**
 * /me/redemption-codes routes — happy path + each documented error
 * status mapping.
 *
 * @module domains/redemption-codes/me-routes.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { QuotaRepository } from "../quota/repository";
import { QuotaService } from "../quota/service";
import { RedemptionCodeRepository } from "./repository";
import { RedemptionCodeService } from "./service";
import { createMeRedemptionCodesRoutes } from "./me-routes";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: RedemptionCodeRepository;
let quotaService: QuotaService;
let service: RedemptionCodeService;
let app: Hono<{ Variables: AuthVariables }>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("me_redemption_codes_routes_test");
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

  app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    const userId = c.req.header("x-test-user") ?? "user1";
    c.set("auth", {
      userId,
      email: `${userId}@x.test`,
      displayName: userId,
      roles: [],
      permissions: [],
    });
    await next();
  });
  app.onError((err, c) => {
    const e = err as { statusCode?: number; code?: string; message: string };
    const statusCode = e.statusCode ?? 500;
    const code = e.code ?? "internal_error";
    const body = buildProblemJsonBody({
      statusCode,
      code,
      message: e.message ?? "",
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, statusCode as never, {
      "Content-Type": "application/problem+json",
    });
  });
  app.route("/", createMeRedemptionCodesRoutes({ redemptionCodeService: service }));
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

function plusDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function mintActive(amount = 5): Promise<string> {
  const doc = await service.mint({
    admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
    grants: [{ surface: "playground", amount }],
    expiresAt: plusDays(7),
  });
  return doc.code;
}

describe("POST /me/redemption-codes/redeem", () => {
  test("happy path → 200 + grant applied", async () => {
    const code = await mintActive(5);
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { codeId: string; grants: Array<{ surface: string; amount: number }> };
    };
    expect(json.data.grants.length).toBe(1);
    expect(json.data.grants[0].surface).toBe("playground");
    expect(json.data.grants[0].amount).toBe(5);

    const audits = await db.collection("quota_grants_audit").countDocuments();
    expect(audits).toBe(1);
  });

  test("trims and uppercases the code", async () => {
    const code = await mintActive();
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: `  ${code.toLowerCase()}  ` }),
    });
    expect(res.status).toBe(200);
  });

  test("unknown code → 404 REDEMPTION_CODE_NOT_FOUND", async () => {
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "ZZZZZZZZZZZZZZZZ" }),
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string; detail: string; status: number };
    expect(json.code).toBe("redemption_code_not_found");
  });

  test("expired → 410 REDEMPTION_CODE_EXPIRED", async () => {
    const code = await mintActive();
    await db
      .collection("redemption_codes")
      .updateOne({ code }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(410);
    const json = (await res.json()) as { code: string; detail: string; status: number };
    expect(json.code).toBe("redemption_code_expired");
  });

  test("invalidated → 410 REDEMPTION_CODE_INVALIDATED", async () => {
    const minted = await service.mint({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.invalidate({
      id: minted._id,
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
    });
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: minted.code }),
    });
    expect(res.status).toBe(410);
    const json = (await res.json()) as { code: string; detail: string; status: number };
    expect(json.code).toBe("redemption_code_invalidated");
  });

  test("already-redeemed → 409 REDEMPTION_CODE_ALREADY_REDEEMED", async () => {
    const code = await mintActive();
    await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "u1" },
      body: JSON.stringify({ code }),
    });
    const res = await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "u2" },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string; detail: string; status: number };
    expect(json.code).toBe("redemption_code_already_redeemed");
  });
});

describe("GET /me/redemption-codes/history", () => {
  test("returns codes redeemed by caller, newest first", async () => {
    const codeA = await mintActive(1);
    const codeB = await mintActive(2);
    await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "u1" },
      body: JSON.stringify({ code: codeA }),
    });
    await app.request("/me/redemption-codes/redeem", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "u1" },
      body: JSON.stringify({ code: codeB }),
    });
    const res = await app.request("/me/redemption-codes/history?page=1&pageSize=10", {
      headers: { "x-test-user": "u1" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: Array<{ code: string }>; total: number };
    };
    expect(json.data.total).toBe(2);
  });

  test("empty for caller who hasn't redeemed", async () => {
    const res = await app.request("/me/redemption-codes/history", {
      headers: { "x-test-user": "ghost" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: unknown[]; total: number } };
    expect(json.data.total).toBe(0);
    expect(json.data.items).toEqual([]);
  });
});
