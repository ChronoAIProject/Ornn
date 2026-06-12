/**
 * Admin skill-management routes — mount + dispatch tests (#877).
 *
 * Mirrors the harness in `domains/admin/quota/routes.test.ts`: a Hono
 * app with a synthetic auth middleware that reads `x-test-perms`, an
 * `onError` that renders RFC 7807 problem+json via `buildProblemJsonBody`,
 * and `app.request()` for dispatch.
 *
 * `createAdminRoutes` reads `skillRepo["collection"]` directly and drives
 * a live MongoDB cursor chain (countDocuments + find/sort/skip/limit), so
 * the skill repository is a REAL `SkillRepository` over an in-memory
 * MongoDB — never a faked cursor. `skillService`, `analyticsEmitter`, and
 * `agentsealScanner` are dependency-injected fakes so the 403 gate can be
 * proven to fire BEFORE any service/DB work (call-count-0 + DB-untouched).
 *
 * @module domains/admin/routes.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Collection, type Db } from "mongodb";
import { SkillRepository } from "../skills/crud/repository";
import { AnalyticsEmitter, type AnalyticsTracker } from "../../infra/analytics";
import type { IAgentSealScanner, ScanInput, ScanResult } from "../../infra/agentseal";
import type { SkillService } from "../skills/crud/service";
import type { UserDirectoryRepository } from "../users/repository";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createAdminRoutes, type AdminRoutesConfig } from "./routes";

const ADMIN_PERM = "ornn:admin:skill";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let skillRepo: SkillRepository;
let skillCollection: Collection;
/** Default app — scanner omitted, fresh DI fakes per test. */
let app: Hono<{ Variables: AuthVariables }>;

/** Recorded analytics emissions, asserted by the happy-path cases. */
interface TrackCall {
  userId: string | null;
  event: string;
  properties: Record<string, unknown>;
}
let trackCalls: TrackCall[];

class RecordingTracker implements AnalyticsTracker {
  track(
    userId: string | null,
    event: string,
    properties?: Readonly<Record<string, unknown>>,
  ): void {
    trackCalls.push({ userId, event, properties: { ...(properties ?? {}) } });
  }
  async shutdown(): Promise<void> {
    /* no-op */
  }
}

/** Call counters on the DI-faked skill service. */
let deleteSkillCalls: string[];
let rescanCalls: Array<{ idOrName: string; version: string }>;
/** Configurable rescan result for the happy-path AgentSeal case. */
let rescanResult: Awaited<ReturnType<SkillService["rescanVersion"]>>;

/**
 * Throwing proxy — any property access that the route layer does NOT
 * legitimately use (everything but `deleteSkill` / `rescanVersion`)
 * surfaces as a hard failure rather than a silent `undefined`.
 */
function throwingSkillService(
  overrides: Partial<SkillService>,
): SkillService {
  return new Proxy(overrides as SkillService, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`skillService.${String(prop)} accessed but not faked`);
    },
  });
}

function makeSkillService(): SkillService {
  return throwingSkillService({
    async deleteSkill(guid: string): Promise<void> {
      deleteSkillCalls.push(guid);
    },
    async rescanVersion(idOrName: string, version: string) {
      rescanCalls.push({ idOrName, version });
      return rescanResult;
    },
  } as Partial<SkillService>);
}

/** AgentSeal scanner DI fake — wired only in the happy-path rescan case. */
let scannerScanCalls: ScanInput[];
function makeScanner(): IAgentSealScanner {
  return {
    async scan(input: ScanInput): Promise<ScanResult | null> {
      scannerScanCalls.push(input);
      return null;
    },
  };
}

/**
 * `userDirectoryRepo` is held on the config for future drill-downs and is
 * only `void`-referenced by the module today — a throwing proxy proves it
 * is never actually consumed.
 */
const userDirectoryRepo = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(`userDirectoryRepo.${String(prop)} unexpectedly used`);
    },
  },
) as UserDirectoryRepository;

function buildApp(config: AdminRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const router = createAdminRoutes(config);
  const app = new Hono<{ Variables: AuthVariables }>();
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
  return app;
}

function baseConfig(
  overrides: Partial<AdminRoutesConfig> = {},
): AdminRoutesConfig {
  return {
    analyticsEmitter: new AnalyticsEmitter({
      tracker: new RecordingTracker(),
      errorSampleRate: 0,
    }),
    userDirectoryRepo,
    skillRepo,
    skillService: makeSkillService(),
    ...overrides,
  };
}

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "x-test-perms": perms.join(",") };
}

async function seedSkill(
  doc: Record<string, unknown>,
): Promise<void> {
  await skillCollection.insertOne(doc as never);
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("admin_routes_test");
  skillRepo = new SkillRepository(db);
  await skillRepo.ensureIndexes();
  skillCollection = db.collection("skills");
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await skillCollection.deleteMany({});
  trackCalls = [];
  deleteSkillCalls = [];
  rescanCalls = [];
  scannerScanCalls = [];
  rescanResult = {
    skillGuid: "g-1",
    skillName: "alpha",
    version: "1.0",
    scan: { score: 92, findings: [{ rule: "x" }], scannedAt: "2026-06-05T00:00:00Z", agentsealVersion: "1.2.3" },
  };
  app = buildApp(baseConfig());
});

describe("GET /admin/skills", () => {
  test("default page/pageSize clamp + item mapping (Date→ISO, tags fallback)", async () => {
    const createdOn = new Date("2026-01-02T03:04:05Z");
    const updatedOn = new Date("2026-02-03T04:05:06Z");
    await seedSkill({
      _id: "g-1",
      name: "alpha",
      description: "first skill",
      createdBy: "u1",
      createdByEmail: "u1@x.test",
      createdByDisplayName: "User One",
      createdOn,
      updatedOn,
      metadata: { tags: ["t1", "t2"] },
      isPrivate: false,
    });
    // A doc missing isPrivate + tags exercises the defaults.
    await seedSkill({
      _id: "g-2",
      name: "beta",
      description: "second skill",
      createdBy: "u2",
      createdOn,
      updatedOn,
    });

    const res = await app.request("/admin/skills", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        items: Array<{
          guid: string;
          createdOn: string;
          updatedOn: string;
          isPrivate: boolean;
          tags: string[];
          createdByEmail: string;
          createdByDisplayName: string;
        }>;
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data.total).toBe(2);
    expect(json.data.page).toBe(1); // clamped to ≥ 1
    expect(json.data.pageSize).toBe(20); // default
    expect(json.data.totalPages).toBe(1);
    const byGuid = new Map(json.data.items.map((i) => [i.guid, i]));
    const alpha = byGuid.get("g-1")!;
    expect(alpha.createdOn).toBe(createdOn.toISOString());
    expect(alpha.updatedOn).toBe(updatedOn.toISOString());
    expect(alpha.isPrivate).toBe(false);
    expect(alpha.tags).toEqual(["t1", "t2"]);
    const beta = byGuid.get("g-2")!;
    expect(beta.isPrivate).toBe(true); // default fallback
    expect(beta.tags).toEqual([]); // tags fallback
    expect(beta.createdByEmail).toBe(""); // missing → ""
    expect(beta.createdByDisplayName).toBe("");
  });

  test("page < 1 and pageSize > 100 clamp to page≥1 / pageSize≤100", async () => {
    const res = await app.request("/admin/skills?page=0&pageSize=9999", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { page: number; pageSize: number } };
    expect(json.data.page).toBe(1);
    expect(json.data.pageSize).toBe(100);
  });

  test("q regex-escapes special chars + matches name OR description", async () => {
    await seedSkill({
      _id: "g-dot",
      name: "a.b.c",
      description: "literal dotted name",
      createdBy: "u1",
      createdOn: new Date(),
      updatedOn: new Date(),
    });
    // A decoy that an UNescaped `.` regex would also match.
    await seedSkill({
      _id: "g-decoy",
      name: "axbxc",
      description: "should not match an escaped query",
      createdBy: "u1",
      createdOn: new Date(),
      updatedOn: new Date(),
    });
    // Matches via description only.
    await seedSkill({
      _id: "g-desc",
      name: "unrelated",
      description: "contains a.b.c inside the body",
      createdBy: "u1",
      createdOn: new Date(),
      updatedOn: new Date(),
    });

    const res = await app.request(`/admin/skills?q=${encodeURIComponent("a.b.c")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: Array<{ guid: string }>; total: number } };
    const guids = json.data.items.map((i) => i.guid).sort();
    expect(guids).toEqual(["g-desc", "g-dot"]); // decoy excluded by escape
    expect(json.data.total).toBe(2);
  });

  test("userId query maps to createdBy filter", async () => {
    await seedSkill({
      _id: "g-mine",
      name: "mine",
      description: "owned by u1",
      createdBy: "u1",
      createdOn: new Date(),
      updatedOn: new Date(),
    });
    await seedSkill({
      _id: "g-theirs",
      name: "theirs",
      description: "owned by u2",
      createdBy: "u2",
      createdOn: new Date(),
      updatedOn: new Date(),
    });

    const res = await app.request("/admin/skills?userId=u1", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: Array<{ guid: string }>; total: number } };
    expect(json.data.total).toBe(1);
    expect(json.data.items[0]!.guid).toBe("g-mine");
  });

  test("pagination math — second page offset + totalPages", async () => {
    for (let i = 0; i < 5; i++) {
      await seedSkill({
        _id: `g-${i}`,
        name: `skill-${i}`,
        description: `desc ${i}`,
        createdBy: "u1",
        createdOn: new Date(Date.now() + i * 1000),
        updatedOn: new Date(),
      });
    }
    const res = await app.request("/admin/skills?page=2&pageSize=2", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: unknown[]; total: number; page: number; pageSize: number; totalPages: number };
    };
    expect(json.data.total).toBe(5);
    expect(json.data.page).toBe(2);
    expect(json.data.pageSize).toBe(2);
    expect(json.data.items.length).toBe(2);
    expect(json.data.totalPages).toBe(3); // ceil(5 / 2)
  });

  test("403 when admin perm missing — DB never queried", async () => {
    await seedSkill({
      _id: "g-1",
      name: "alpha",
      description: "seeded",
      createdBy: "u1",
      createdOn: new Date(),
      updatedOn: new Date(),
    });
    let countQueries = 0;
    const realCount = skillCollection.countDocuments.bind(skillCollection);
    skillCollection.countDocuments = ((...args: Parameters<typeof realCount>) => {
      countQueries += 1;
      return realCount(...args);
    }) as typeof skillCollection.countDocuments;
    try {
      const res = await app.request("/admin/skills", { headers: authHeaders([]) });
      expect(res.status).toBe(403);
      expect(countQueries).toBe(0); // gate fired before the cursor chain
    } finally {
      skillCollection.countDocuments = realCount;
    }
  });
});

describe("DELETE /admin/skills/:id", () => {
  test("happy path — deleteSkill called + adminAction analytics emitted", async () => {
    const res = await app.request("/admin/skills/g-1", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { success: boolean }; error: null };
    expect(json.data.success).toBe(true);
    expect(json.error).toBeNull();
    expect(deleteSkillCalls).toEqual(["g-1"]);
    const emitted = trackCalls.find((t) => t.event === "skill.deleted");
    expect(emitted).toBeDefined();
    expect(emitted!.properties.skillId).toBe("g-1");
    expect(emitted!.properties.adminAction).toBe(true);
  });

  test("403 when admin perm missing — deleteSkill never called", async () => {
    const res = await app.request("/admin/skills/g-1", {
      method: "DELETE",
      headers: authHeaders([]),
    });
    expect(res.status).toBe(403);
    expect(deleteSkillCalls.length).toBe(0);
  });
});

describe("POST /admin/skills/:idOrName/versions/:version/agentseal-rescan", () => {
  test("503 when scanner is not wired — rescanVersion never called", async () => {
    const res = await app.request(
      "/admin/skills/alpha/versions/1.0/agentseal-rescan",
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { data: null; error: { code: string } };
    expect(json.data).toBeNull();
    expect(json.error.code).toBe("agentseal_disabled");
    expect(rescanCalls.length).toBe(0);
  });

  test("happy path with scanner wired — envelope + analytics with score/findings", async () => {
    const appWithScanner = buildApp(baseConfig({ agentsealScanner: makeScanner() }));
    const res = await appWithScanner.request(
      "/admin/skills/alpha/versions/1.0/agentseal-rescan",
      { method: "POST", headers: authHeaders() },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { skillGuid: string; version: string; scan: { score: number } };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data.skillGuid).toBe("g-1");
    expect(json.data.scan.score).toBe(92);
    expect(rescanCalls).toEqual([{ idOrName: "alpha", version: "1.0" }]);
    const emitted = trackCalls.find((t) => t.event === "skill.agentseal_rescanned");
    expect(emitted).toBeDefined();
    expect(emitted!.properties.score).toBe(92);
    expect(emitted!.properties.findings).toBe(1);
    expect(emitted!.properties.adminAction).toBe(true);
  });

  test("403 when admin perm missing — rescanVersion never called", async () => {
    const appWithScanner = buildApp(baseConfig({ agentsealScanner: makeScanner() }));
    const res = await appWithScanner.request(
      "/admin/skills/alpha/versions/1.0/agentseal-rescan",
      { method: "POST", headers: authHeaders([]) },
    );
    expect(res.status).toBe(403);
    expect(rescanCalls.length).toBe(0);
    expect(scannerScanCalls.length).toBe(0);
  });
});
