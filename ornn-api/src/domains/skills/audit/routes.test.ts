/**
 * Route-level tests for the skill-audit routes (#873).
 *
 * Mounts `createAuditRoutes` on a bare Hono app, stubs the upstream auth
 * context (production wires this via proxyAuthSetup), and supplies
 * hand-rolled fakes for the two collaborators (auditService,
 * skillService). The project onError → RFC 7807 mapping is replicated so
 * thrown AppErrors surface with the right status.
 *
 * Coverage:
 *   - GET  /skills/:id/audit          → 200 / 404 audit_not_found /
 *     private-skill anon 404 / private + !canReadSkill 404
 *   - GET  .../summary-by-version     → 200 / private 404
 *   - GET  .../history                → 200 / ?version passthrough / private 404
 *   - POST /skills/:id/audit          → owner 200 / admin 200 /
 *     non-owner non-admin 403 / invalid body 400
 *   - POST /admin/skills/:id/audit    → 200 with perm / 403 without
 *
 * @module domains/skills/audit/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAuditRoutes, type AuditRoutesConfig } from "./routes";
import { buildProblemJsonBody } from "../../../shared/types/index";
import type { AuditRecord } from "./types";
import type { SkillDetailResponse } from "../../../shared/types/index";

const ADMIN_PERM = "ornn:admin:skill";
const OWNER_ID = "owner-1";

// ---- Fixtures --------------------------------------------------------

function record(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    _id: "audit-1",
    skillGuid: "skill-guid-1",
    version: "1.0.0",
    skillHash: "hash-1",
    status: "completed",
    verdict: "green",
    overallScore: 8.2,
    scores: [],
    findings: [],
    model: "gpt-test",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    completedAt: new Date("2026-01-01T00:01:00Z"),
    triggeredBy: OWNER_ID,
    ...overrides,
  };
}

function skill(overrides: Partial<SkillDetailResponse> = {}): SkillDetailResponse {
  return {
    guid: "skill-guid-1",
    name: "demo-skill",
    description: "a demo",
    license: null,
    compatibility: null,
    metadata: {},
    tags: [],
    skillHash: "hash-1",
    presignedPackageUrl: "https://storage.test/skill.zip",
    isPrivate: false,
    createdBy: OWNER_ID,
    createdOn: "2026-01-01T00:00:00Z",
    updatedOn: "2026-01-01T00:00:00Z",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    version: "1.0.0",
    ...overrides,
  };
}

// ---- Fakes -----------------------------------------------------------

class FakeAuditService {
  audit: AuditRecord | null = record();
  history: AuditRecord[] = [record()];
  summary: Record<string, AuditRecord> = { "1.0.0": record() };
  runResult: AuditRecord = record({ status: "running" });
  listHistoryCalls: Array<{ idOrName: string; version?: string | undefined }> = [];
  runAuditCalls: Array<{ idOrName: string; triggeredBy: string; force: boolean }> = [];

  async getAudit(): Promise<AuditRecord | null> {
    return this.audit;
  }
  async listHistory(idOrName: string, version?: string): Promise<ReadonlyArray<AuditRecord>> {
    this.listHistoryCalls.push({ idOrName, version });
    return this.history;
  }
  async summaryByVersion(): Promise<Record<string, AuditRecord>> {
    return this.summary;
  }
  async runAudit(
    idOrName: string,
    opts: { triggeredBy: string; force?: boolean },
  ): Promise<AuditRecord> {
    this.runAuditCalls.push({ idOrName, triggeredBy: opts.triggeredBy, force: opts.force ?? false });
    return this.runResult;
  }
}

class FakeSkillService {
  constructor(private s: SkillDetailResponse) {}
  async getSkill(): Promise<SkillDetailResponse> {
    return this.s;
  }
}

// ---- App builder -----------------------------------------------------

function buildApp(
  cfg: { auditService?: FakeAuditService; skillService?: FakeSkillService },
  opts: { authenticated?: boolean; userId?: string; permissions?: string[] } = {},
): { app: Hono; auditService: FakeAuditService } {
  const { authenticated = true, userId = OWNER_ID, permissions = [] } = opts;
  const auditService = cfg.auditService ?? new FakeAuditService();
  const skillService = cfg.skillService ?? new FakeSkillService(skill());

  const full: AuditRoutesConfig = {
    auditService: auditService as unknown as AuditRoutesConfig["auditService"],
    skillService: skillService as unknown as AuditRoutesConfig["skillService"],
  };

  const app = new Hono();
  if (authenticated) {
    app.use("*", async (c, next) => {
      c.set("auth" as never, {
        userId,
        email: `${userId}@test.local`,
        displayName: userId,
        roles: [],
        permissions,
      } as never);
      await next();
    });
  }
  app.route("/api/v1", createAuditRoutes(full));
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = buildProblemJsonBody({
      statusCode: status,
      code,
      message: err.message,
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, status as never, {
      "Content-Type": "application/problem+json",
    });
  });
  return { app, auditService };
}

// ---- GET /skills/:id/audit -------------------------------------------

describe("GET /skills/:idOrName/audit", () => {
  it("returns 200 with the audit record", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: { _id: string } };
    expect(parsed.data._id).toBe("audit-1");
  });

  it("returns 404 audit_not_found when there is no audit", async () => {
    const audit = new FakeAuditService();
    audit.audit = null;
    const { app } = buildApp({ auditService: audit }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit");
    expect(res.status).toBe(404);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("audit_not_found");
  });

  it("returns 404 skill_not_found for an anonymous caller on a private skill", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: true }));
    const { app } = buildApp({ skillService: skillSvc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit");
    expect(res.status).toBe(404);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("skill_not_found");
  });

  it("returns 404 when an authed caller cannot read the private skill", async () => {
    const skillSvc = new FakeSkillService(
      skill({ isPrivate: true, createdBy: "someone-else" }),
    );
    const { app } = buildApp(
      { skillService: skillSvc },
      { authenticated: true, userId: "stranger", permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/audit");
    expect(res.status).toBe(404);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("skill_not_found");
  });
});

// ---- GET .../summary-by-version --------------------------------------

describe("GET /skills/:idOrName/audit/summary-by-version", () => {
  it("returns 200 with the per-version map", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit/summary-by-version");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: { byVersion: Record<string, unknown> } };
    expect(Object.keys(parsed.data.byVersion)).toContain("1.0.0");
  });

  it("returns 404 for an anonymous caller on a private skill", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: true }));
    const { app } = buildApp({ skillService: skillSvc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit/summary-by-version");
    expect(res.status).toBe(404);
  });
});

// ---- GET .../history -------------------------------------------------

describe("GET /skills/:idOrName/audit/history", () => {
  it("returns 200 with the items array", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit/history");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: { items: unknown[] } };
    expect(parsed.data.items).toHaveLength(1);
  });

  it("passes ?version through to the service", async () => {
    const { app, auditService } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit/history?version=2.1.0");
    expect(res.status).toBe(200);
    expect(auditService.listHistoryCalls[0]!.version).toBe("2.1.0");
  });

  it("returns 404 for an anonymous caller on a private skill", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: true }));
    const { app } = buildApp({ skillService: skillSvc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/audit/history");
    expect(res.status).toBe(404);
  });
});

// ---- POST /skills/:id/audit ------------------------------------------

describe("POST /skills/:idOrName/audit", () => {
  it("returns 200 when the owner triggers", async () => {
    const { app, auditService } = buildApp(
      {},
      { authenticated: true, userId: OWNER_ID, permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(200);
    expect(auditService.runAuditCalls[0]!.triggeredBy).toBe(OWNER_ID);
    expect(auditService.runAuditCalls[0]!.force).toBe(true);
  });

  it("returns 200 when a platform admin triggers on someone else's skill", async () => {
    const skillSvc = new FakeSkillService(skill({ createdBy: "someone-else" }));
    const { app } = buildApp(
      { skillService: skillSvc },
      { authenticated: true, userId: "admin-user", permissions: [ADMIN_PERM] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 not_skill_owner for a non-owner non-admin", async () => {
    const skillSvc = new FakeSkillService(skill({ createdBy: "someone-else" }));
    const { app } = buildApp(
      { skillService: skillSvc },
      { authenticated: true, userId: "stranger", permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("not_skill_owner");
  });

  it("returns 400 for an invalid body (force not a boolean)", async () => {
    const { app } = buildApp(
      {},
      { authenticated: true, userId: OWNER_ID, permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: "x" }),
    });
    expect(res.status).toBe(400);
  });
});

// ---- POST /admin/skills/:id/audit ------------------------------------

describe("POST /admin/skills/:idOrName/audit", () => {
  it("returns 200 with the admin permission", async () => {
    const { app, auditService } = buildApp(
      {},
      { authenticated: true, userId: "admin-user", permissions: [ADMIN_PERM] },
    );
    const res = await app.request("/api/v1/admin/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(200);
    expect(auditService.runAuditCalls[0]!.triggeredBy).toBe("admin-user");
  });

  it("returns 403 without the admin permission", async () => {
    const { app } = buildApp(
      {},
      { authenticated: true, userId: "stranger", permissions: [] },
    );
    const res = await app.request("/api/v1/admin/skills/demo-skill/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });
});
