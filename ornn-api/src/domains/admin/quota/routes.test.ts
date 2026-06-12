/**
 * Admin quota routes UT-ADMQROUTE-001..012.
 *
 * Mounts `createAdminQuotaRoutes` directly on a Hono app and dispatches
 * via `app.request()` — no harness needed. After issue #271 the user
 * pool comes from the unified `users` directory; the old `activities`
 * + `admin_users` collections are gone.
 *
 * @module domains/admin/quota/routes.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { UserDirectoryRepository } from "../../users/repository";
import { QuotaRepository } from "../../quota/repository";
import { QuotaService } from "../../quota/service";
import type { AuthVariables } from "../../../middleware/nyxidAuth";
import { createAdminQuotaRoutes } from "./routes";
import { buildProblemJsonBody } from "../../../shared/types/index";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let userDirectoryRepo: UserDirectoryRepository;
let quotaRepo: QuotaRepository;
let quotaService: QuotaService;
let app: Hono<{ Variables: AuthVariables }>;

const ADMIN_PERM = "ornn:admin:skill";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("admin_quota_routes_test");
  userDirectoryRepo = new UserDirectoryRepository(db);
  await userDirectoryRepo.ensureIndexes();
  quotaRepo = new QuotaRepository(db);
  await quotaRepo.ensureIndexes();
  quotaService = new QuotaService({
    repo: quotaRepo,
    defaults: {
      async getQuotaDefaults() {
        return { defaultPlaygroundMonthly: 100, defaultSkillGenMonthly: 10 };
      },
    },
  });
  const router = createAdminQuotaRoutes({ quotaService, userDirectoryRepo });
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
  app.route("/", router);
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("users").deleteMany({});
  await db.collection("quota_buckets").deleteMany({});
  await db.collection("quota_grants_audit").deleteMany({});
});

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "x-test-perms": perms.join(",") };
}

async function seedUser(userId: string, email: string, isAdmin = false) {
  await userDirectoryRepo.upsert({
    userId,
    email,
    displayName: userId,
    isAdmin,
  });
}

describe("UT-ADMQROUTE-012 non-admin → 403", () => {
  test("missing admin perm returns 403; no DB write", async () => {
    const res = await app.request("/admin/quota/grant", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders([]) },
      body: JSON.stringify({ userId: "u1", surface: "playground", amount: 5 }),
    });
    expect(res.status).toBe(403);
    const audits = await db.collection("quota_grants_audit").countDocuments();
    expect(audits).toBe(0);
  });
});

describe("UT-ADMQROUTE-008 grant amount=0 → 400", () => {
  test("zod blocks; no DB write", async () => {
    const res = await app.request("/admin/quota/grant", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ userId: "u1", surface: "playground", amount: 0 }),
    });
    expect(res.status).toBe(400);
    const audits = await db.collection("quota_grants_audit").countDocuments();
    expect(audits).toBe(0);
  });
});

describe("UT-ADMQROUTE-009 grant amount>100k → 400", () => {
  test("zod blocks; no DB write", async () => {
    const res = await app.request("/admin/quota/grant", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ userId: "u1", surface: "playground", amount: 100_001 }),
    });
    expect(res.status).toBe(400);
    const audits = await db.collection("quota_grants_audit").countDocuments();
    expect(audits).toBe(0);
  });
});

describe("UT-ADMQROUTE-010 valid grant → 200 + audit row + bucket update", () => {
  test("audit appended; bucket has adminGrant=5", async () => {
    const res = await app.request("/admin/quota/grant", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ userId: "u1", surface: "playground", amount: 5, note: "demo" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { auditId: string; applied: number } };
    expect(json.data.applied).toBe(1);
    expect(typeof json.data.auditId).toBe("string");
    const audit = await db.collection("quota_grants_audit").findOne({ targetUserId: "u1" });
    expect(audit?.amount).toBe(5);
    expect(audit?.note).toBe("demo");
    const bucket = await db.collection("quota_buckets").findOne({ userId: "u1" });
    expect(bucket?.adminGrant).toBe(5);
  });
});

describe("UT-ADMQROUTE-011 bulk grant trimmed body", () => {
  test("bulk endpoint accepts list", async () => {
    const res = await app.request("/admin/quota/grant/bulk", {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        userIds: ["u1", "u2", "u3"],
        surface: "playground",
        amount: 5,
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { applied: number; requested: number } };
    expect(json.data.applied).toBe(3);
    expect(json.data.requested).toBe(3);
  });
});

describe("UT-ADMQROUTE-001 GET /admin/quota/users surface=playground", () => {
  test("returns shape with monthMarker + items", async () => {
    await seedUser("u1", "u1@x");
    const res = await app.request("/admin/quota/users?surface=playground", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        items: Array<{ userId: string; remaining: number }>;
        monthMarker: string;
      };
    };
    expect(json.data.items.length).toBe(1);
    expect(json.data.items[0]!.userId).toBe("u1");
    expect(json.data.monthMarker).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("UT-ADMQROUTE-002 surface=skillGen filter", () => {
  test("snapshot read on skillGen surface", async () => {
    await seedUser("u1", "u1@x");
    const res = await app.request("/admin/quota/users?surface=skillGen", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: Array<{ defaultAllotment: number }> } };
    expect(json.data.items[0]!.defaultAllotment).toBe(10);
  });
});

describe("UT-ADMQROUTE-003 admin users excluded", () => {
  test("admin marked in directory not surfaced", async () => {
    await seedUser("a1", "a1@x", true);
    await seedUser("u1", "u1@x", false);
    const res = await app.request("/admin/quota/users?surface=playground", {
      headers: authHeaders(),
    });
    const json = (await res.json()) as { data: { items: Array<{ userId: string }> } };
    expect(json.data.items.map((r) => r.userId)).not.toContain("a1");
    expect(json.data.items.map((r) => r.userId)).toContain("u1");
  });
});

describe("UT-ADMQROUTE-006 remaining floors at 0", () => {
  test("over-limit user reports remaining=0, not negative", async () => {
    await seedUser("u1", "u1@x");
    await db.collection("quota_buckets").insertOne({
      _id: ("u1:playground:" + monthMarkerNow()) as unknown as never,
      userId: "u1",
      surface: "playground",
      monthMarker: monthMarkerNow(),
      monthStart: new Date(),
      monthEnd: new Date(),
      defaultAllotment: 10,
      adminGrant: 0,
      used: 100,
      usedByModel: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.request("/admin/quota/users?surface=playground", {
      headers: authHeaders(),
    });
    const json = (await res.json()) as { data: { items: Array<{ remaining: number }> } };
    expect(json.data.items[0]!.remaining).toBe(0);
  });
});

describe("UT-ADMQROUTE-007 lifetime endpoint sorted asc", () => {
  test("3 buckets returned in chronological order", async () => {
    const months = ["2026-04", "2026-06", "2026-05"];
    for (const m of months) {
      await db.collection("quota_buckets").insertOne({
        _id: `u1:playground:${m}` as unknown as never,
        userId: "u1",
        surface: "playground",
        monthMarker: m,
        monthStart: new Date(`${m}-01T00:00:00Z`),
        monthEnd: new Date(`${m}-28T00:00:00Z`),
        defaultAllotment: 100,
        adminGrant: 0,
        used: 1,
        usedByModel: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const res = await app.request(
      "/admin/quota/users/u1/lifetime?surface=playground",
      { headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: Array<{ monthMarker: string }> } };
    expect(json.data.items.map((i) => i.monthMarker)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
});

describe("UT-ADMQROUTE-005 /admin/quota/grants pagination", () => {
  test("returns audit list", async () => {
    await quotaService.grant({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      targetUserId: "u1",
      surface: "playground",
      amount: 5,
    });
    await quotaService.grant({
      admin: { userId: "admin1", email: "admin@x", displayName: "Admin" },
      targetUserId: "u2",
      surface: "playground",
      amount: 7,
    });
    const res = await app.request("/admin/quota/grants?page=1&pageSize=10", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total: number; items: Array<{ amount: number }> } };
    expect(json.data.total).toBe(2);
    expect(json.data.items.length).toBe(2);
  });
});

function monthMarkerNow(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
