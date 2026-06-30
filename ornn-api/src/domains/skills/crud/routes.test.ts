/**
 * Route-level tests for the skill CRUD routes (#874).
 *
 * Mounts the real `createSkillRoutes` on a bare Hono app and supplies
 * DI fakes for the two primary collaborators:
 *   - `skillService` — a Proxy whose un-asserted methods THROW, so any
 *     handler that accidentally reaches an un-stubbed method fails loud
 *     instead of silently returning undefined.
 *   - `skillRepo` — a hand-rolled fake exposing only `findByGuid` /
 *     `findByName` / `findByNyxidService` (the canRead/canManage gates).
 *
 * Auth is wired the same way production does it: a top-level middleware
 * stamps `c.set("auth", ...)` (mirrors `proxyAuthSetup`), then the route's
 * own `nyxidAuthMiddleware` / `requirePermission` / `buildActorContext`
 * read from it. The org-lookup getter is left unmounted, so
 * `buildActorContext` resolves to `{ memberships: [], membershipsResolved:
 * true }` — every test caller is "member of no org", which is all these
 * gate-and-delegate tests need.
 *
 * The onError handler mirrors the global RFC 7807 mapping so thrown
 * AppErrors surface with the right status + `code`.
 *
 * @module domains/skills/crud/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import JSZip from "jszip";
import { createSkillRoutes, type SkillRoutesConfig } from "./routes";
import {
  buildProblemJsonBody,
  type SkillDetailResponse,
  type SkillDocument,
} from "../../../shared/types/index";
import { __resetRateLimitForTests } from "../../../middleware/rateLimit";

const CREATE = "ornn:skill:create";
const READ = "ornn:skill:read";
const UPDATE = "ornn:skill:update";
const DELETE = "ornn:skill:delete";
const OWNER = "owner-1";

// ---- Fixtures --------------------------------------------------------

function detail(overrides: Partial<SkillDetailResponse> = {}): SkillDetailResponse {
  return {
    guid: "guid-1",
    name: "demo-skill",
    description: "a demo",
    license: null,
    compatibility: null,
    metadata: {},
    tags: [],
    skillHash: "hash-1",
    presignedPackageUrl: "https://storage.test/skill.zip",
    isPrivate: false,
    createdBy: OWNER,
    createdOn: "2026-01-01T00:00:00Z",
    updatedOn: "2026-01-01T00:00:00Z",
    sharedWithUsers: [],
    sharedWithOrgs: [],
    version: "1.0",
    ...overrides,
  };
}

function skillDoc(overrides: Partial<SkillDocument> = {}): SkillDocument {
  return {
    guid: "guid-1",
    name: "demo-skill",
    description: "a demo",
    license: null,
    compatibility: null,
    metadata: { category: "plain" },
    skillHash: "hash-1",
    storageKey: "skills/guid-1/1.0.zip",
    createdBy: OWNER,
    createdOn: new Date("2026-01-01T00:00:00Z"),
    updatedBy: OWNER,
    updatedOn: new Date("2026-01-01T00:00:00Z"),
    isPrivate: false,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    latestVersion: "1.0",
    ...overrides,
  } as SkillDocument;
}

// ---- Fakes -----------------------------------------------------------

/**
 * A skillService stand-in: only the methods listed in `impl` are callable.
 * Every other property resolves to a function that throws — so an
 * accidental handler reach is loud rather than silent.
 */
function fakeSkillService(impl: Record<string, (...args: unknown[]) => unknown>) {
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (..._args: unknown[]) => {
        throw new Error(`skillService.${prop} should not be called in this test`);
      };
    },
  }) as unknown as SkillRoutesConfig["skillService"];
}

interface BuildOpts {
  authenticated?: boolean;
  userId?: string;
  permissions?: string[];
  /** Forwarded user access token — required by GET /nyxid-services/:id/skills. */
  userAccessToken?: string;
  service?: Record<string, (...args: unknown[]) => unknown>;
  repo?: Partial<{
    findByGuid: (guid: string) => Promise<SkillDocument | null>;
    findByName: (name: string) => Promise<SkillDocument | null>;
    findByNyxidService: (...args: unknown[]) => Promise<unknown>;
  }>;
  nyxidServiceClient?: { findVisibleToCaller: (...args: unknown[]) => Promise<unknown> };
  extraNyxidServices?: readonly string[];
  resolveUser?: (
    userId: string,
  ) => Promise<{ userId: string; email: string; displayName: string } | null>;
  /** #1136 — capture reactive skillset-recompute hook invocations. */
  onSkillsetRecompute?: (changedSkill: { guid: string; name: string }) => void;
  /** #1159 — capture targeted skillset mirror re-export hook invocations. */
  onSkillsetMirrorForMember?: (skillGuid: string, skillName: string) => void;
}

function buildApp(opts: BuildOpts = {}) {
  const {
    authenticated = true,
    userId = OWNER,
    permissions = [],
    userAccessToken,
    service = {},
    repo = {},
    nyxidServiceClient,
    extraNyxidServices = [],
    resolveUser,
    onSkillsetRecompute,
    onSkillsetMirrorForMember,
  } = opts;

  const skillRepo = {
    findByGuid: repo.findByGuid ?? (async () => null),
    findByName: repo.findByName ?? (async () => null),
    findByNyxidService: repo.findByNyxidService ?? (async () => ({ skills: [], total: 0 })),
  } as unknown as SkillRoutesConfig["skillRepo"];

  const config: SkillRoutesConfig = {
    skillService: fakeSkillService(service),
    skillRepo,
    maxFileSize: 10 * 1024 * 1024,
    nyxidServiceClient: (nyxidServiceClient ??
      { findVisibleToCaller: async () => null }) as unknown as SkillRoutesConfig["nyxidServiceClient"],
    extraNyxidServicesResolver: async () => extraNyxidServices,
    ...(resolveUser ? { resolveUser } : {}),
    ...(onSkillsetRecompute ? { fireSkillsetRecompute: onSkillsetRecompute } : {}),
    ...(onSkillsetMirrorForMember ? { fireSkillsetMirrorForMember: onSkillsetMirrorForMember } : {}),
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
        ...(userAccessToken !== undefined ? { userAccessToken } : {}),
      } as never);
      await next();
    });
  }
  app.route("/api/v1", createSkillRoutes(config));
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
  return app;
}

beforeEach(() => __resetRateLimitForTests());
afterEach(() => __resetRateLimitForTests());

/** A minimal valid skill ZIP as an ArrayBuffer (a valid `BodyInit`). */
async function skillZipBytes(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  const folder = zip.folder("demo-skill")!;
  folder.file(
    "SKILL.md",
    [
      "---",
      "name: demo-skill",
      "description: A demo skill.",
      "metadata:",
      "  category: plain",
      'version: "1.0"',
      "---",
      "# demo-skill",
    ].join("\n"),
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

// ======================================================================
// POST /skills
// ======================================================================

describe("POST /skills", () => {
  test("401 when unauthenticated", async () => {
    const app = buildApp({ authenticated: false });
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(401);
  });

  test("403 without ornn:skill:create", async () => {
    const app = buildApp({ permissions: [READ] });
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(res.status).toBe(403);
  });

  test("400 invalid_content_type for a non-zip body", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_content_type");
  });

  test("201 + Location, delegating to createSkill then getSkill", async () => {
    const calls: string[] = [];
    const app = buildApp({
      permissions: [CREATE],
      service: {
        createSkill: async () => {
          calls.push("createSkill");
          return { guid: "guid-1" };
        },
        getSkill: async () => {
          calls.push("getSkill");
          return detail();
        },
      },
    });
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: await skillZipBytes(),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe("/api/v1/skills/guid-1");
    expect(calls).toEqual(["createSkill", "getSkill"]);
    const body = (await res.json()) as { data: { guid: string }; error: null };
    expect(body.data.guid).toBe("guid-1");
    expect(body.error).toBeNull();
  });

  test("400 empty_body for an empty zip body", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/zip" },
      body: new Uint8Array([]),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("empty_body");
  });
});

// ======================================================================
// POST /skills/pull
// ======================================================================

describe("POST /skills/pull", () => {
  test("403 without create permission", async () => {
    const app = buildApp({ permissions: [READ] });
    const res = await app.request("/api/v1/skills/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r" }),
    });
    expect(res.status).toBe(403);
  });

  test("400 when neither githubUrl nor repo is provided", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skills/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("201 delegating to createSkillFromGitHub", async () => {
    const calls: string[] = [];
    const app = buildApp({
      permissions: [CREATE],
      service: {
        createSkillFromGitHub: async () => {
          calls.push("createSkillFromGitHub");
          return { guid: "guid-1", source: { type: "github", repo: "o/r", ref: "HEAD", path: "" } };
        },
        getSkill: async () => detail(),
      },
    });
    const res = await app.request("/api/v1/skills/pull", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "o/r" }),
    });
    expect(res.status).toBe(201);
    expect(calls).toContain("createSkillFromGitHub");
  });
});

// ======================================================================
// POST /skills/:id/refresh
// ======================================================================

describe("POST /skills/:id/refresh", () => {
  test("403 not_skill_owner for a non-owner non-admin", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      service: { getSkill: async () => detail({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("not_skill_owner");
  });

  test("owner triggers a real refresh (200)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      service: {
        getSkill: async () => detail({ createdBy: OWNER }),
        refreshSkillFromSource: async () => {
          calls.push("refreshSkillFromSource");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(calls).toContain("refreshSkillFromSource");
  });

  test("fires the targeted skillset mirror re-export on a real refresh (#1159)", async () => {
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      service: {
        getSkill: async () => detail({ createdBy: OWNER }),
        refreshSkillFromSource: async () => detail({ createdBy: OWNER, name: "demo-skill" }),
      },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([["guid-1", "demo-skill"]]);
  });

  test("does NOT fire the re-export on a dry-run refresh (#1159)", async () => {
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      service: {
        getSkill: async () => detail({ createdBy: OWNER }),
        previewRefreshFromSource: async () => ({ skill: { guid: "guid-1" }, hasChanges: false }),
      },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([]);
  });

  test("dryRun delegates to previewRefreshFromSource", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      service: {
        getSkill: async () => detail({ createdBy: OWNER }),
        previewRefreshFromSource: async () => {
          calls.push("previewRefreshFromSource");
          return { skill: { guid: "guid-1", name: "demo-skill" }, hasChanges: false };
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["previewRefreshFromSource"]);
  });
});

// ======================================================================
// PUT /skills/:id/source
// ======================================================================

describe("PUT /skills/:id/source", () => {
  test("403 for a non-owner", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      service: { getSkill: async () => detail({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/source", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.com/o/r" }),
    });
    expect(res.status).toBe(403);
  });

  test("owner sets the source (200)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      service: {
        getSkill: async () => detail({ createdBy: OWNER }),
        setSkillSource: async () => {
          calls.push("setSkillSource");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/source", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ githubUrl: "https://github.com/o/r" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toContain("setSkillSource");
  });
});

// ======================================================================
// GET /skills/:idOrName/json
// ======================================================================

describe("GET /skills/:idOrName/json", () => {
  test("401 without auth", async () => {
    const app = buildApp({ authenticated: false });
    const res = await app.request("/api/v1/skills/demo-skill/json");
    expect(res.status).toBe(401);
  });

  test("404 when a private skill is not readable by the caller", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [READ],
      service: { getSkill: async () => detail({ isPrivate: true, createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill/json");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("skill_not_found");
  });

  test("200 delegating to getSkillJson for a public skill", async () => {
    const calls: string[] = [];
    const app = buildApp({
      permissions: [READ],
      service: {
        getSkill: async () => detail({ isPrivate: false }),
        getSkillJson: async () => {
          calls.push("getSkillJson");
          return { name: "demo-skill", description: "d", version: "1.0", metadata: {}, files: {} };
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/json");
    expect(res.status).toBe(200);
    expect(calls).toContain("getSkillJson");
  });
});

// ======================================================================
// GET /skills/:idOrName/versions
// ======================================================================

describe("GET /skills/:idOrName/versions", () => {
  test("404 for an anonymous caller on a private skill", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkill: async () => detail({ isPrivate: true }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill/versions");
    expect(res.status).toBe(404);
  });

  test("200 with items for a public skill", async () => {
    const app = buildApp({
      authenticated: false,
      service: {
        getSkill: async () => detail({ isPrivate: false }),
        listSkillVersions: async () => [{ version: "1.0" }],
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/versions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(1);
  });
});

// ======================================================================
// GET /skills/:idOrName/closure (#968)
// ======================================================================

describe("GET /skills/:idOrName/closure", () => {
  const linear = [
    { guid: "g-c", name: "c", version: "1.0", skillHash: "h-c", depth: 1 },
    { guid: "g-b", name: "b", version: "1.0", skillHash: "h-b", depth: 0 },
  ];

  test("200 returns the topo-ordered items envelope (linear chain)", async () => {
    const captured: { idOrName: string | undefined; version: string | undefined; anon: boolean | undefined } = {
      idOrName: undefined,
      version: undefined,
      anon: undefined,
    };
    const app = buildApp({
      authenticated: true,
      permissions: [READ],
      service: {
        resolveSkillClosure: async (...args: unknown[]) => {
          captured.idOrName = args[0] as string;
          captured.version = args[2] as string | undefined;
          captured.anon = (args[1] as { userId: string }).userId === "";
          return linear;
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/closure?version=1.0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: typeof linear }; error: null };
    expect(body.error).toBeNull();
    expect(body.data.items.map((i) => i.name)).toEqual(["c", "b"]);
    expect(captured.idOrName).toBe("demo-skill");
    expect(captured.version).toBe("1.0");
    expect(captured.anon).toBe(false);
    // Regression guard (#978): the skillset master prompt is a SKILLSET
    // concept only — the shared skill closure envelope stays `{ items }`,
    // with NO `instructions` key leaking onto this path.
    expect("instructions" in body.data).toBe(false);
    expect(Object.keys(body.data)).toEqual(["items"]);
  });

  test("200 with a deduped diamond closure", async () => {
    const diamond = [
      { guid: "g-d", name: "d", version: "1.0", skillHash: "h-d", depth: 2 },
      { guid: "g-b", name: "b", version: "1.0", skillHash: "h-b", depth: 1 },
      { guid: "g-c", name: "c", version: "1.0", skillHash: "h-c", depth: 1 },
    ];
    const app = buildApp({
      authenticated: false,
      service: { resolveSkillClosure: async () => diamond },
    });
    const res = await app.request("/api/v1/skills/demo-skill/closure");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: typeof diamond } };
    // d (the shared leaf) appears once and sorts before its dependents.
    expect(body.data.items.filter((i) => i.name === "d")).toHaveLength(1);
    expect(body.data.items.map((i) => i.name).indexOf("d")).toBe(0);
  });

  test("passes an anonymous actor (userId='') when unauthenticated", async () => {
    let anon: boolean | undefined;
    const app = buildApp({
      authenticated: false,
      service: {
        resolveSkillClosure: async (...args: unknown[]) => {
          anon = (args[1] as { userId: string }).userId === "";
          return [];
        },
      },
    });
    const res = await app.request("/api/v1/skills/public-skill/closure");
    expect(res.status).toBe(200);
    expect(anon).toBe(true);
  });

  test("409 dependency_cycle propagates from the service", async () => {
    const { AppError } = await import("../../../shared/types/index");
    const app = buildApp({
      authenticated: false,
      service: {
        resolveSkillClosure: async () => {
          throw AppError.conflict("dependency_cycle", "cycle at a@1.0");
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/closure");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("dependency_cycle");
  });

  test("409 dependency_conflict propagates from the service", async () => {
    const { AppError } = await import("../../../shared/types/index");
    const app = buildApp({
      authenticated: false,
      service: {
        resolveSkillClosure: async () => {
          throw AppError.conflict("dependency_conflict", "b pinned to 1.0 and 2.0");
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/closure");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("dependency_conflict");
  });

  test("404 skill_dependency_not_found propagates from the service", async () => {
    const { AppError } = await import("../../../shared/types/index");
    const app = buildApp({
      authenticated: false,
      service: {
        resolveSkillClosure: async () => {
          throw AppError.notFound("skill_dependency_not_found", "missing dep");
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/closure");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("skill_dependency_not_found");
  });
});

// ======================================================================
// GET /skills/:idOrName/versions/:from/diff/:to
// ======================================================================

describe("GET .../diff", () => {
  test("200 delegating to diffVersions", async () => {
    const calls: string[] = [];
    const app = buildApp({
      authenticated: false,
      service: {
        getSkill: async () => detail({ isPrivate: false }),
        diffVersions: async () => {
          calls.push("diffVersions");
          return { diff: {} };
        },
      },
    });
    const res = await app.request("/api/v1/skills/demo-skill/versions/1.0/diff/1.1");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["diffVersions"]);
  });

  test("404 for an anonymous caller on a private skill", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkill: async () => detail({ isPrivate: true }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill/versions/1.0/diff/1.1");
    expect(res.status).toBe(404);
  });
});

// ======================================================================
// GET /skills/:idOrName
// ======================================================================

describe("GET /skills/:idOrName", () => {
  test("200 for a public skill (anonymous)", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkill: async () => detail({ isPrivate: false }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { guid: string } };
    expect(body.data.guid).toBe("guid-1");
  });

  test("404 for an anonymous caller on a private skill", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkill: async () => detail({ isPrivate: true }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill");
    expect(res.status).toBe(404);
  });

  test("sets RFC 8594 Deprecation header on a deprecated skill", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkill: async () => detail({ isPrivate: false, isDeprecated: true }) },
    });
    const res = await app.request("/api/v1/skills/demo-skill");
    expect(res.status).toBe(200);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Link")).toContain('rel="deprecation"');
  });
});

// ======================================================================
// PATCH /skills/:id/versions/:version (deprecation toggle)
// ======================================================================

describe("PATCH /skills/:id/versions/:version", () => {
  test("404 when the skill is unknown", async () => {
    const app = buildApp({ permissions: [UPDATE], repo: { findByGuid: async () => null } });
    const res = await app.request("/api/v1/skills/guid-1/versions/1.0", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDeprecated: true }),
    });
    expect(res.status).toBe(404);
  });

  test("403 when the caller cannot manage the skill", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/versions/1.0", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDeprecated: true }),
    });
    expect(res.status).toBe(403);
  });

  test("200 delegating to setVersionDeprecation for the owner", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        setVersionDeprecation: async () => {
          calls.push("setVersionDeprecation");
          return { skillGuid: "guid-1", skillName: "demo-skill", version: "1.0", isDeprecated: true };
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/versions/1.0", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isDeprecated: true }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["setVersionDeprecation"]);
  });
});

// ======================================================================
// Dist-tags
// ======================================================================

describe("dist-tags routes", () => {
  test("GET dist-tags 200 for a public skill", async () => {
    const app = buildApp({
      authenticated: false,
      repo: { findByGuid: async () => skillDoc({ isPrivate: false }) },
      service: { getDistTags: async () => ({ latest: "1.0" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { tags: Record<string, string> } };
    expect(body.data.tags.latest).toBe("1.0");
  });

  test("GET dist-tags 404 for an unknown skill", async () => {
    const app = buildApp({ authenticated: false, repo: { findByGuid: async () => null, findByName: async () => null } });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags");
    expect(res.status).toBe(404);
  });

  test("PUT dist-tag 403 for a non-owner", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags/beta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0" }),
    });
    expect(res.status).toBe(403);
  });

  test("PUT dist-tag 200 delegating to setDistTag (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        setDistTag: async () => {
          calls.push("setDistTag");
          return { latest: "1.0", beta: "1.0" };
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags/beta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["setDistTag"]);
  });

  test("DELETE dist-tag 200 delegating to deleteDistTag (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        deleteDistTag: async () => {
          calls.push("deleteDistTag");
          return { latest: "1.0" };
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags/beta", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["deleteDistTag"]);
  });

  test("PUT dist-tag fires the targeted skillset mirror re-export (#1159)", async () => {
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER, name: "demo-skill" }) },
      service: { setDistTag: async () => ({ latest: "1.0", beta: "1.0" }) },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags/beta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.0" }),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([["guid-1", "demo-skill"]]);
  });

  test("DELETE dist-tag fires the targeted skillset mirror re-export (#1159)", async () => {
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER, name: "demo-skill" }) },
      service: { deleteDistTag: async () => ({ latest: "1.0" }) },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1/dist-tags/beta", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(fired).toEqual([["guid-1", "demo-skill"]]);
  });
});

// ======================================================================
// PUT /skills/:id
// ======================================================================

describe("PUT /skills/:id", () => {
  test("404 when the skill is unknown", async () => {
    const app = buildApp({ permissions: [UPDATE], repo: { findByGuid: async () => null } });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: true }),
    });
    expect(res.status).toBe(404);
  });

  test("403 when the caller cannot manage", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: true }),
    });
    expect(res.status).toBe(403);
  });

  test("400 no_update when neither zip nor isPrivate is supplied", async () => {
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("no_update");
  });

  test("200 JSON visibility update delegating to updateSkill (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        updateSkill: async () => {
          calls.push("updateSkill");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: true }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["updateSkill"]);
  });

  test("200 ZIP republish delegating to updateSkill (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        updateSkill: async () => {
          calls.push("updateSkill");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: await skillZipBytes(),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["updateSkill"]);
  });

  test("ZIP republish fires the targeted skillset mirror re-export (#1159)", async () => {
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: { updateSkill: async () => detail({ createdBy: OWNER, name: "demo-skill" }) },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: await skillZipBytes(),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([["guid-1", "demo-skill"]]);
  });

  test("JSON-only visibility update does NOT fire the targeted re-export (#1159)", async () => {
    // A privacy flip changes readability, not content — it must NOT trigger
    // the content-path re-export (the visibility-recompute hook handles it).
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: { updateSkill: async () => detail({ createdBy: OWNER, name: "demo-skill" }) },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: true }),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([]);
  });

  test("200 ZIP republish for a write grantee — content edit is the write tier (#1123)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: "editor",
      permissions: [UPDATE],
      repo: {
        findByGuid: async () =>
          skillDoc({
            createdBy: OWNER,
            isPrivate: true,
            grants: [{ type: "user", id: "editor", level: "write" }],
          }),
      },
      service: {
        updateSkill: async () => {
          calls.push("updateSkill");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: await skillZipBytes(),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["updateSkill"]);
  });

  test("403 when a write grantee tries to flip visibility — that is admin-only (#1123)", async () => {
    const app = buildApp({
      userId: "editor",
      permissions: [UPDATE],
      repo: {
        findByGuid: async () =>
          skillDoc({
            createdBy: OWNER,
            isPrivate: true,
            grants: [{ type: "user", id: "editor", level: "write" }],
          }),
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: false }),
    });
    expect(res.status).toBe(403);
  });

  test("403 when a read-only grantee tries to republish content (#1123)", async () => {
    const app = buildApp({
      userId: "reader",
      permissions: [UPDATE],
      repo: {
        findByGuid: async () =>
          skillDoc({
            createdBy: OWNER,
            isPrivate: true,
            grants: [{ type: "user", id: "reader", level: "read" }],
          }),
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", {
      method: "PUT",
      headers: { "content-type": "application/zip" },
      body: await skillZipBytes(),
    });
    expect(res.status).toBe(403);
  });
});

// ======================================================================
// PUT /skills/:id/permissions
// ======================================================================

describe("PUT /skills/:id/permissions", () => {
  test("403 for a non-owner", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: false }),
    });
    expect(res.status).toBe(403);
  });

  test("200 delegating to setSkillPermissions (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        setSkillPermissions: async () => {
          calls.push("setSkillPermissions");
          return detail({ createdBy: OWNER });
        },
        getSkill: async () => detail({ createdBy: OWNER }),
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: false, sharedWithUsers: [], sharedWithOrgs: [] }),
    });
    expect(res.status).toBe(200);
    expect(calls).toContain("setSkillPermissions");
  });

  test("fires the skillset recompute hook after a permissions change (#1136)", async () => {
    const recomputed: Array<{ guid: string; name: string }> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        setSkillPermissions: async () => detail({ createdBy: OWNER }),
        getSkill: async () => detail({ createdBy: OWNER }),
      },
      onSkillsetRecompute: (s) => recomputed.push(s),
    });
    const res = await app.request("/api/v1/skills/guid-1/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: false, sharedWithUsers: [], sharedWithOrgs: [] }),
    });
    expect(res.status).toBe(200);
    expect(recomputed).toHaveLength(1);
    expect(recomputed[0]!.guid).toBe("guid-1");
  });

  test("fires the targeted skillset re-export after a permissions change (#1161)", async () => {
    // A privacy flip changes each exported skillset's public subset, so the
    // permissions path must re-export the affected skillsets immediately.
    const fired: Array<[string, string]> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER, name: "pdf-tools" }) },
      service: {
        setSkillPermissions: async () => detail({ createdBy: OWNER, name: "pdf-tools" }),
        getSkill: async () => detail({ createdBy: OWNER, name: "pdf-tools" }),
      },
      onSkillsetMirrorForMember: (guid, name) => fired.push([guid, name]),
    });
    const res = await app.request("/api/v1/skills/guid-1/permissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPrivate: true, sharedWithUsers: [], sharedWithOrgs: [] }),
    });
    expect(res.status).toBe(200);
    expect(fired).toEqual([["guid-1", "pdf-tools"]]);
  });
});

// ======================================================================
// POST /skills/:id/transfer-ownership (#1123)
// ======================================================================

describe("POST /skills/:id/transfer-ownership", () => {
  const ALICE = { userId: "alice", email: "alice@x.io", displayName: "Alice" };

  function transferReq(app: Hono, newOwnerUserId: string) {
    return app.request("/api/v1/skills/guid-1/transfer-ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newOwnerUserId }),
    });
  }

  test("403 without ornn:skill:update", async () => {
    const app = buildApp({ permissions: [READ] });
    expect((await transferReq(app, "alice")).status).toBe(403);
  });

  test("404 when the skill is unknown", async () => {
    const app = buildApp({ permissions: [UPDATE], repo: { findByGuid: async () => null } });
    expect((await transferReq(app, "alice")).status).toBe(404);
  });

  test("403 when the caller is not the owner / admin", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
    });
    expect((await transferReq(app, "alice")).status).toBe(403);
  });

  test("409 ownership_conflict when transferring to the current owner", async () => {
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      resolveUser: async () => ALICE,
    });
    const res = await transferReq(app, OWNER);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("ownership_conflict");
  });

  test("400 invalid_transfer_target when the target is not a known Ornn user", async () => {
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      resolveUser: async () => null,
    });
    const res = await transferReq(app, "ghost");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("invalid_transfer_target");
  });

  test("200 delegating to transferSkillOwnership (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      resolveUser: async () => ALICE,
      service: {
        transferSkillOwnership: async () => {
          calls.push("transferSkillOwnership");
          return detail({ createdBy: "alice" });
        },
      },
    });
    const res = await transferReq(app, "alice");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["transferSkillOwnership"]);
    expect(((await res.json()) as { data: { skill: { createdBy: string } } }).data.skill.createdBy).toBe("alice");
  });

  test("platform admin may force-transfer a skill they do not own", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: "admin-1",
      permissions: [UPDATE, "ornn:admin:skill"],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      resolveUser: async () => ALICE,
      service: {
        transferSkillOwnership: async () => {
          calls.push("transferSkillOwnership");
          return detail({ createdBy: "alice" });
        },
      },
    });
    const res = await transferReq(app, "alice");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["transferSkillOwnership"]);
  });
});

// ======================================================================
// PUT /skills/:id/nyxid-service
// ======================================================================

describe("PUT /skills/:id/nyxid-service", () => {
  test("403 for a non-owner", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/nyxid-service", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nyxidServiceId: "svc-1" }),
    });
    expect(res.status).toBe(403);
  });

  test("200 delegating to tieToNyxidService (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        tieToNyxidService: async () => {
          calls.push("tieToNyxidService");
          return detail({ createdBy: OWNER });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/nyxid-service", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nyxidServiceId: null }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["tieToNyxidService"]);
  });
});

// ======================================================================
// GET /nyxid-services/:serviceId/skills
// ======================================================================

describe("GET /nyxid-services/:serviceId/skills", () => {
  test("404 when the caller has no forwarded token", async () => {
    const app = buildApp({ permissions: [READ] });
    const res = await app.request("/api/v1/nyxid-services/svc-1/skills");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("NYXID_SERVICE_NOT_FOUND");
  });

  test("404 when the service is not visible to the caller", async () => {
    const app = buildApp({
      permissions: [READ],
      userAccessToken: "tok-1",
      nyxidServiceClient: { findVisibleToCaller: async () => null },
    });
    const res = await app.request("/api/v1/nyxid-services/svc-1/skills");
    expect(res.status).toBe(404);
  });

  test("200 listing skills for an admin (public) service", async () => {
    const app = buildApp({
      permissions: [READ],
      userAccessToken: "tok-1",
      nyxidServiceClient: {
        findVisibleToCaller: async () => ({
          id: "svc-1",
          slug: "svc-1",
          label: "Service 1",
          visibility: "public",
          createdBy: "admin-x",
        }),
      },
      repo: {
        findByNyxidService: async () => ({
          skills: [
            {
              guid: "guid-1",
              name: "demo-skill",
              description: "a demo",
              createdBy: OWNER,
              createdOn: new Date("2026-01-01T00:00:00Z"),
              updatedOn: new Date("2026-01-01T00:00:00Z"),
              isPrivate: false,
              metadata: { category: "plain", tags: ["x"] },
              isSystemSkill: true,
            },
          ],
          total: 1,
        }),
      },
    });
    const res = await app.request("/api/v1/nyxid-services/svc-1/skills");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Array<{ guid: string }>; total: number; service: { tier: string } };
    };
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]!.guid).toBe("guid-1");
    expect(body.data.service.tier).toBe("admin");
  });

  test("404 on a personal service the caller does not own", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [READ],
      userAccessToken: "tok-1",
      nyxidServiceClient: {
        findVisibleToCaller: async () => ({
          id: "svc-1",
          slug: "svc-1",
          label: "Service 1",
          visibility: "private",
          createdBy: "someone-else",
        }),
      },
    });
    const res = await app.request("/api/v1/nyxid-services/svc-1/skills");
    expect(res.status).toBe(404);
  });
});

describe("PUT /skills/:id/nyxid-service — synthetic service", () => {
  test("ties to a synthetic:<slug> service from EXTRA_NYXID_SERVICES", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [UPDATE],
      userAccessToken: "tok-1",
      extraNyxidServices: ["My Synthetic Service"],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        tieToNyxidService: async (...args: unknown[]) => {
          calls.push("tieToNyxidService");
          // Drive the route's synthetic resolver to assert it short-circuits
          // the NyxID round-trip for a `synthetic:` id.
          const lookup = args[3] as (id: string) => Promise<unknown>;
          const resolved = (await lookup("synthetic:my-synthetic-service")) as {
            visibility: string;
          } | null;
          expect(resolved?.visibility).toBe("public");
          return detail({ createdBy: OWNER, isSystemSkill: true, isPrivate: false });
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/nyxid-service", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nyxidServiceId: "synthetic:my-synthetic-service" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["tieToNyxidService"]);
  });
});

// ======================================================================
// DELETE /skills/:id
// ======================================================================

describe("DELETE /skills/:id", () => {
  test("403 without delete permission", async () => {
    const app = buildApp({ permissions: [UPDATE] });
    const res = await app.request("/api/v1/skills/guid-1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("404 when the skill is unknown", async () => {
    const app = buildApp({ permissions: [DELETE], repo: { findByGuid: async () => null } });
    const res = await app.request("/api/v1/skills/guid-1", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("200 delegating to deleteSkill (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [DELETE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        deleteSkill: async () => {
          calls.push("deleteSkill");
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["deleteSkill"]);
    const body = (await res.json()) as { data: { success: boolean } };
    expect(body.data.success).toBe(true);
  });

  test("fires the skillset recompute hook with the deleted skill's name+guid (#1136)", async () => {
    const recomputed: Array<{ guid: string; name: string }> = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [DELETE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: { deleteSkill: async () => {} },
      onSkillsetRecompute: (s) => recomputed.push(s),
    });
    const res = await app.request("/api/v1/skills/guid-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    // Name captured before deletion so the reverse index still matches.
    expect(recomputed).toEqual([{ guid: "guid-1", name: "demo-skill" }]);
  });
});

// ======================================================================
// DELETE /skills/:id/versions/:version
// ======================================================================

describe("DELETE /skills/:id/versions/:version", () => {
  test("403 when the caller cannot manage", async () => {
    const app = buildApp({
      userId: "stranger",
      permissions: [DELETE],
      repo: { findByGuid: async () => skillDoc({ createdBy: "someone-else" }) },
    });
    const res = await app.request("/api/v1/skills/guid-1/versions/1.0", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("200 delegating to deleteVersion (owner)", async () => {
    const calls: string[] = [];
    const app = buildApp({
      userId: OWNER,
      permissions: [DELETE],
      repo: { findByGuid: async () => skillDoc({ createdBy: OWNER }) },
      service: {
        deleteVersion: async () => {
          calls.push("deleteVersion");
        },
      },
    });
    const res = await app.request("/api/v1/skills/guid-1/versions/1.0", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["deleteVersion"]);
  });
});
