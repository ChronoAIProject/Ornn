/**
 * Route-level tests for the analytics read routes (#880).
 *
 * Mounts `createAnalyticsRoutes` on a bare Hono app, stubs the upstream
 * auth context (production wires this via proxyAuthSetup), and supplies
 * hand-rolled fakes for the two collaborators (analyticsService,
 * skillService). The project onError → RFC 7807 mapping is replicated so
 * thrown AppErrors surface with the right status. Harness cloned from
 * `skills/audit/routes.test.ts`.
 *
 * Coverage:
 *   - GET /skills/:id/analytics        → 200 / INVALID_WINDOW 400 /
 *     window+version passthrough
 *   - GET .../analytics/pulls          → 200 / INVALID_BUCKET 400 /
 *     invalid_range (bad from / bad to / from>=to) / from-to-version
 *     passthrough
 *   - authorizeRead visibility         → public anon 200 / private anon
 *     404 / private authed canRead 200 / private authed !canRead 404
 *
 * @module domains/analytics/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createAnalyticsRoutes, type AnalyticsRoutesConfig } from "./routes";
import { buildProblemJsonBody } from "../../shared/types/index";
import type { SkillAnalyticsSummary, PullBucketCount } from "./types";
import type { SkillDetailResponse } from "../../shared/types/index";

const OWNER_ID = "owner-1";

// ---- Fixtures --------------------------------------------------------

function summary(overrides: Partial<SkillAnalyticsSummary> = {}): SkillAnalyticsSummary {
  return {
    skillGuid: "skill-guid-1",
    window: "30d",
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    successRate: null,
    latencyMs: { p50: null, p95: null, p99: null },
    uniqueUsers: 0,
    topErrorCodes: [],
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

class FakeAnalyticsService {
  summaryResult: SkillAnalyticsSummary = summary();
  pullsResult: ReadonlyArray<PullBucketCount> = [];
  getSummaryCalls: Array<{
    skillGuid: string;
    window: "7d" | "30d" | "all";
    version?: string | undefined;
  }> = [];
  getPullsCalls: Array<{
    skillGuid: string;
    bucket: string;
    from?: Date | undefined;
    to?: Date | undefined;
    version?: string | undefined;
  }> = [];

  async getSummary(
    skillGuid: string,
    window: "7d" | "30d" | "all",
    version?: string,
  ): Promise<SkillAnalyticsSummary> {
    this.getSummaryCalls.push({ skillGuid, window, version });
    return this.summaryResult;
  }
  async getPullsTimeSeries(params: {
    skillGuid: string;
    bucket: string;
    from?: Date;
    to?: Date;
    version?: string;
  }): Promise<ReadonlyArray<PullBucketCount>> {
    this.getPullsCalls.push(params);
    return this.pullsResult;
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
  cfg: { analyticsService?: FakeAnalyticsService; skillService?: FakeSkillService },
  opts: { authenticated?: boolean; userId?: string; permissions?: string[] } = {},
): { app: Hono; analyticsService: FakeAnalyticsService } {
  const { authenticated = true, userId = OWNER_ID, permissions = [] } = opts;
  const analyticsService = cfg.analyticsService ?? new FakeAnalyticsService();
  const skillService = cfg.skillService ?? new FakeSkillService(skill());

  const full: AnalyticsRoutesConfig = {
    analyticsService: analyticsService as unknown as AnalyticsRoutesConfig["analyticsService"],
    skillService: skillService as unknown as AnalyticsRoutesConfig["skillService"],
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
  app.route("/api/v1", createAnalyticsRoutes(full));
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
  return { app, analyticsService };
}

// ---- GET /skills/:id/analytics ---------------------------------------

describe("GET /skills/:idOrName/analytics", () => {
  it("returns 200 with the summary for a public skill (anonymous)", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: { skillGuid: string }; error: null };
    expect(parsed.data.skillGuid).toBe("skill-guid-1");
    expect(parsed.error).toBeNull();
  });

  it("returns 400 INVALID_WINDOW for an unrecognized window", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics?window=year");
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("INVALID_WINDOW");
  });

  it("passes window + version through to the service", async () => {
    const { app, analyticsService } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics?window=7d&version=2.1.0");
    expect(res.status).toBe(200);
    expect(analyticsService.getSummaryCalls[0]!.window).toBe("7d");
    expect(analyticsService.getSummaryCalls[0]!.version).toBe("2.1.0");
    expect(analyticsService.getSummaryCalls[0]!.skillGuid).toBe("skill-guid-1");
  });
});

// ---- GET /skills/:id/analytics/pulls ---------------------------------

describe("GET /skills/:idOrName/analytics/pulls", () => {
  it("returns 200 with the items array for a public skill (anonymous)", async () => {
    const svc = new FakeAnalyticsService();
    svc.pullsResult = [
      { bucket: "2026-01-01T00:00:00.000Z", total: 2, bySource: { api: 2, web: 0, playground: 0 } },
    ];
    const { app } = buildApp({ analyticsService: svc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics/pulls");
    expect(res.status).toBe(200);
    const parsed = (await res.json()) as { data: { items: unknown[] }; error: null };
    expect(parsed.data.items).toHaveLength(1);
  });

  it("returns 400 INVALID_BUCKET for an unrecognized bucket", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics/pulls?bucket=week");
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("INVALID_BUCKET");
  });

  it("returns 400 invalid_range for a non-ISO 'from'", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics/pulls?from=not-a-date");
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("invalid_range");
  });

  it("returns 400 invalid_range for a non-ISO 'to'", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics/pulls?to=nope");
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("invalid_range");
  });

  it("returns 400 invalid_range when from >= to", async () => {
    const { app } = buildApp({}, { authenticated: false });
    const res = await app.request(
      "/api/v1/skills/demo-skill/analytics/pulls?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z",
    );
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("invalid_range");
  });

  it("passes bucket + from + to + version through to the service", async () => {
    const { app, analyticsService } = buildApp({}, { authenticated: false });
    const res = await app.request(
      "/api/v1/skills/demo-skill/analytics/pulls?bucket=month&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z&version=1.0.0",
    );
    expect(res.status).toBe(200);
    const call = analyticsService.getPullsCalls[0]!;
    expect(call.skillGuid).toBe("skill-guid-1");
    expect(call.bucket).toBe("month");
    expect(call.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(call.to?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(call.version).toBe("1.0.0");
  });
});

// ---- authorizeRead visibility ----------------------------------------

describe("analytics visibility (authorizeRead)", () => {
  it("allows an anonymous caller to read a PUBLIC skill's analytics", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: false }));
    const { app } = buildApp({ skillService: skillSvc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics");
    expect(res.status).toBe(200);
  });

  it("returns 404 skill_not_found for an anonymous caller on a PRIVATE skill", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: true }));
    const { app } = buildApp({ skillService: skillSvc }, { authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/analytics");
    expect(res.status).toBe(404);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("skill_not_found");
  });

  it("allows an authed caller who can read the PRIVATE skill (author)", async () => {
    const skillSvc = new FakeSkillService(skill({ isPrivate: true, createdBy: OWNER_ID }));
    const { app } = buildApp(
      { skillService: skillSvc },
      { authenticated: true, userId: OWNER_ID, permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/analytics");
    expect(res.status).toBe(200);
  });

  it("returns 404 when an authed caller cannot read the PRIVATE skill", async () => {
    const skillSvc = new FakeSkillService(
      skill({ isPrivate: true, createdBy: "someone-else" }),
    );
    const { app } = buildApp(
      { skillService: skillSvc },
      { authenticated: true, userId: "stranger", permissions: [] },
    );
    const res = await app.request("/api/v1/skills/demo-skill/analytics");
    expect(res.status).toBe(404);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("skill_not_found");
  });
});
