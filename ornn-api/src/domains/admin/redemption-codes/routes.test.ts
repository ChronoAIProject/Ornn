/**
 * Admin redemption-code routes — mount + dispatch tests.
 *
 * Mirrors the pattern in `domains/admin/quota/routes.test.ts`: a real
 * mongodb-memory-server, a Hono app with a synthetic auth middleware
 * that reads `x-test-perms`, and `app.request()` for dispatch.
 *
 * @module domains/admin/redemption-codes/routes.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { QuotaRepository } from "../../quota/repository";
import { QuotaService } from "../../quota/service";
import { RedemptionCodeRepository } from "../../redemption-codes/repository";
import { RedemptionCodeService } from "../../redemption-codes/service";
import type { AuthVariables } from "../../../middleware/nyxidAuth";
import { createAdminRedemptionCodesRoutes } from "./routes";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: RedemptionCodeRepository;
let quotaService: QuotaService;
let service: RedemptionCodeService;
let app: Hono<{ Variables: AuthVariables }>;

const ADMIN_PERM = "ornn:admin:skill";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("admin_redemption_codes_routes_test");
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
  const router = createAdminRedemptionCodesRoutes({ redemptionCodeService: service });

  app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    const permsHeader = c.req.header("x-test-perms") ?? "";
    const permissions = permsHeader.length > 0 ? permsHeader.split(",") : [];
    c.set("auth", {
      userId: "admin1",
      email: "admin@x.test",
      displayName: "Admin",
      roles: [],
      permissions,
    });
    await next();
  });
  app.onError((err, c) => {
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.statusCode && e.code) {
      return c.json(
        { data: null, error: { code: e.code, message: e.message } },
        e.statusCode as never,
      );
    }
    return c.json(
      { data: null, error: { code: "INTERNAL", message: e.message } },
      500,
    );
  });
  app.route("/", router);
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

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "x-test-perms": perms.join(",") };
}

function plusDays(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

describe("POST /admin/redemption-codes", () => {
  test("admin with permission → 200 returns code", async () => {
    const res = await app.request("/admin/redemption-codes", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        grants: [{ surface: "playground", amount: 5 }],
        note: "demo",
        expiresAt: plusDays(7).toISOString(),
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { code: { code: string; status: string; grants: unknown[] } };
    };
    expect(json.data.code.code.length).toBe(16);
    expect(json.data.code.status).toBe("active");
    expect(json.data.code.grants.length).toBe(1);
  });

  test("non-admin → 403", async () => {
    const res = await app.request("/admin/redemption-codes", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders([]) },
      body: JSON.stringify({
        grants: [{ surface: "playground", amount: 5 }],
        expiresAt: plusDays(1).toISOString(),
      }),
    });
    expect(res.status).toBe(403);
  });

  test("expiresAt in past → 400 zod", async () => {
    const res = await app.request("/admin/redemption-codes", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        grants: [{ surface: "playground", amount: 5 }],
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/redemption-codes/:id/invalidate", () => {
  test("active → 200", async () => {
    const minted = await service.mint({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    const res = await app.request(
      `/admin/redemption-codes/${minted._id}/invalidate`,
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { code: { status: string } } };
    expect(json.data.code.status).toBe("invalidated");
  });

  test("on redeemed code → 409 ALREADY_REDEEMED", async () => {
    const minted = await service.mint({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.redeem({
      code: minted.code,
      redeemer: { userId: "u1", email: "u1@x", displayName: "U" },
      permissions: [],
    });
    const res = await app.request(
      `/admin/redemption-codes/${minted._id}/invalidate`,
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("REDEMPTION_CODE_ALREADY_REDEEMED");
  });

  test("on already-invalidated → 409 ALREADY_INVALIDATED", async () => {
    const minted = await service.mint({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      grants: [{ surface: "playground", amount: 5 }],
      expiresAt: plusDays(7),
    });
    await service.invalidate({
      id: minted._id,
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
    });
    const res = await app.request(
      `/admin/redemption-codes/${minted._id}/invalidate`,
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("REDEMPTION_CODE_ALREADY_INVALIDATED");
  });

  test("unknown id → 404", async () => {
    const res = await app.request(
      `/admin/redemption-codes/ffffffffffffffffffffffff/invalidate`,
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /admin/redemption-codes", () => {
  test("returns paginated list", async () => {
    for (let i = 0; i < 3; i++) {
      await service.mint({
        admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
        grants: [{ surface: "playground", amount: 1 }],
        expiresAt: plusDays(7),
      });
    }
    const res = await app.request("/admin/redemption-codes?page=1&pageSize=10", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: unknown[]; total: number; totalPages: number };
    };
    expect(json.data.total).toBe(3);
    expect(json.data.items.length).toBe(3);
  });
});
