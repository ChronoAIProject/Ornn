/**
 * Caller-scoped /me routes — mount + dispatch tests (#878).
 *
 * Fully dependency-injected. NO MongoDB, NO real NyxID: `skillRepo`,
 * `userDirectoryRepo`, `analyticsEmitter`, and `nyxidServiceClient` are
 * throwing-proxy fakes (only the methods the routes legitimately call
 * are stubbed). The only ambient I/O these routes do is `globalThis.fetch`
 * (the NyxID org-name back-fill proxy at routes.ts:192,334), which is
 * stubbed with save/restore so the suite stays hermetic.
 *
 * The `forward_access_token` contract is load-bearing in prod: org-name
 * resolution only happens when the proxy forwarded the caller's bearer
 * token. Every `authCtx.userAccessToken` call site (routes.ts:184,245,328)
 * is asserted in BOTH the token-present and token-absent arms.
 *
 * Harness mirrors `domains/redemption-codes/me-routes.test.ts`:
 * synthetic auth middleware setting `c.set("auth", ...)`, an `onError`
 * rendering RFC 7807 problem+json via `buildProblemJsonBody`, and
 * `app.request()` dispatch.
 *
 * @module domains/me/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables, OrgMembershipFact } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createMeRoutes } from "./routes";
import type { SkillRepository } from "../skills/crud/repository";
import type { UserDirectoryRepository } from "../users/repository";
import type { AnalyticsEmitter } from "../../infra/analytics";
import type { NyxidServiceClient, NyxidCatalogService } from "../../clients/nyxid/service";

// Obviously-fake, non-secret token used only to assert the
// `forward_access_token` arm is taken. gitleaks-safe: not a real JWT,
// not a real bearer. `.test` host throughout.
const FAKE_TOKEN = "fake-forwarded-token-not-a-secret";
const BASE_URL = "https://nyxid.x.test";

// ---------------------------------------------------------------------------
// Captured side effects + DI fakes
// ---------------------------------------------------------------------------

type DirectoryRow = { userId: string; email: string; displayName: string };
type GrantAgg = {
  orgs: Array<{ id: string; skillCount: number }>;
  users: Array<{ userId: string; skillCount: number }>;
};

let activityEvents: Array<{
  userId: string | null;
  userEmail?: string;
  userDisplayName?: string;
  action: string;
}>;
let serviceCallTokens: string[];
let directoryQueries: Array<readonly string[]>;
/**
 * Captures the `userOrgIds` (2nd) argument of every
 * `aggregateSourcesForReader(userId, userOrgIds)` call. The route derives
 * it from `readUserOrgIds(c)` (routes.ts:304-305) — projected from the
 * mounted org-membership getter — so asserting it pins the scope-query
 * bridge: when the getter is mounted the caller's org ids flow through,
 * and when it's unmounted the route passes `[]` (fail-soft, no over-share).
 */
let sourcesReaderOrgIds: Array<readonly string[]>;
/** Recorded fetch requests so we can assert the bearer was forwarded. */
let fetchCalls: Array<{ url: string; authorization: string | null }>;

/** Per-test programmable responder for the fetch stub. */
let fetchResponder: (url: string) => Response;

// Programmable per-test stubs for the repo aggregation methods.
let grantsAgg: GrantAgg;
let sourcesAgg: GrantAgg;
let directoryRows: DirectoryRow[];
let catalogServices: NyxidCatalogService[];
let extraServiceNames: readonly string[];

function makeSkillRepo(): SkillRepository {
  const impl: Partial<SkillRepository> = {
    async aggregateGrantsByOwner(userId: string) {
      expect(userId).toBe("caller1");
      return grantsAgg;
    },
    async aggregateSourcesForReader(userId: string, userOrgIds: readonly string[]) {
      expect(userId).toBe("caller1");
      sourcesReaderOrgIds.push(userOrgIds);
      return sourcesAgg;
    },
  };
  return new Proxy(impl as SkillRepository, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`skillRepo.${String(prop)} accessed but not faked`);
    },
  });
}

function makeUserDirectoryRepo(): UserDirectoryRepository {
  const impl: Partial<UserDirectoryRepository> = {
    async findByUserIds(ids: readonly string[]): Promise<DirectoryRow[]> {
      directoryQueries.push(ids);
      const set = new Set(ids);
      return directoryRows.filter((r) => set.has(r.userId));
    },
  };
  return new Proxy(impl as UserDirectoryRepository, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`userDirectoryRepo.${String(prop)} accessed but not faked`);
    },
  });
}

function makeAnalyticsEmitter(): AnalyticsEmitter {
  const impl: Partial<AnalyticsEmitter> = {
    trackPlatformActivity(input) {
      activityEvents.push({
        userId: input.userId,
        ...(input.userEmail !== undefined ? { userEmail: input.userEmail } : {}),
        ...(input.userDisplayName !== undefined
          ? { userDisplayName: input.userDisplayName }
          : {}),
        action: input.action,
      });
    },
  };
  return new Proxy(impl as AnalyticsEmitter, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`analyticsEmitter.${String(prop)} accessed but not faked`);
    },
  });
}

function makeNyxidServiceClient(): NyxidServiceClient {
  const impl: Partial<NyxidServiceClient> = {
    async listServicesForCaller(token: string): Promise<NyxidCatalogService[]> {
      serviceCallTokens.push(token);
      return catalogServices;
    },
  };
  return new Proxy(impl as NyxidServiceClient, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`nyxidServiceClient.${String(prop)} accessed but not faked`);
    },
  });
}

// ---------------------------------------------------------------------------
// App builder — synthetic auth middleware so each test can set the token
// (and, for /me/orgs, the membership getter) per request via headers/closure.
// ---------------------------------------------------------------------------

/** Per-request overrides set by the test before dispatch. */
let withToken: boolean;
let mountOrgGetter: boolean;
let orgMemberships: OrgMembershipFact[];

function buildApp(): Hono<{ Variables: AuthVariables }> {
  const router = createMeRoutes({
    nyxidBaseUrlResolver: async () => `${BASE_URL}/`,
    skillRepo: makeSkillRepo(),
    userDirectoryRepo: makeUserDirectoryRepo(),
    analyticsEmitter: makeAnalyticsEmitter(),
    nyxidServiceClient: makeNyxidServiceClient(),
    extraNyxidServicesResolver: async () => extraServiceNames,
  });
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      userId: "caller1",
      email: "caller@x.test",
      displayName: "Caller One",
      roles: ["user"],
      permissions: ["ornn:skill:create"],
      ...(withToken ? { userAccessToken: FAKE_TOKEN } : {}),
    });
    if (mountOrgGetter) {
      c.set("getUserOrgMemberships", async () => orgMemberships);
    }
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

let app: Hono<{ Variables: AuthVariables }>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  activityEvents = [];
  serviceCallTokens = [];
  directoryQueries = [];
  sourcesReaderOrgIds = [];
  fetchCalls = [];
  grantsAgg = { orgs: [], users: [] };
  sourcesAgg = { orgs: [], users: [] };
  directoryRows = [];
  catalogServices = [];
  extraServiceNames = [];
  withToken = false;
  mountOrgGetter = false;
  orgMemberships = [];
  fetchResponder = () => new Response("{}", { status: 200 });

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers = new Headers(init?.headers);
    fetchCalls.push({ url, authorization: headers.get("Authorization") });
    return fetchResponder(url);
  }) as typeof globalThis.fetch;

  app = buildApp();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

describe("GET /me", () => {
  test("returns the five identity fields from the auth context", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        userId: string;
        email: string;
        displayName: string;
        roles: string[];
        permissions: string[];
      };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data).toEqual({
      userId: "caller1",
      email: "caller@x.test",
      displayName: "Caller One",
      roles: ["user"],
      permissions: ["ornn:skill:create"],
    });
  });
});

// ---------------------------------------------------------------------------
// POST /activity/{login,logout}
// ---------------------------------------------------------------------------

describe("POST /activity", () => {
  test("login → emits user.login with identity", async () => {
    const res = await app.request("/activity/login", { method: "POST" });
    expect(res.status).toBe(200);
    expect(activityEvents).toEqual([
      {
        userId: "caller1",
        userEmail: "caller@x.test",
        userDisplayName: "Caller One",
        action: "user.login",
      },
    ]);
  });

  test("logout → emits user.logout with identity", async () => {
    const res = await app.request("/activity/logout", { method: "POST" });
    expect(res.status).toBe(200);
    expect(activityEvents).toEqual([
      {
        userId: "caller1",
        userEmail: "caller@x.test",
        userDisplayName: "Caller One",
        action: "user.logout",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /me/orgs
// ---------------------------------------------------------------------------

describe("GET /me/orgs", () => {
  test("getter unmounted → empty items (fail-soft)", async () => {
    mountOrgGetter = false;
    const res = await app.request("/me/orgs");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: OrgMembershipFact[] } };
    expect(json.data.items).toEqual([]);
  });

  test("getter mounted → populated memberships", async () => {
    mountOrgGetter = true;
    orgMemberships = [
      { userId: "org1", role: "admin", displayName: "Org One" },
      { userId: "org2", role: "member", displayName: "Org Two" },
    ];
    const res = await app.request("/me/orgs");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: OrgMembershipFact[] } };
    expect(json.data.items).toEqual(orgMemberships);
  });
});

// ---------------------------------------------------------------------------
// GET /me/orgs/:orgId
// ---------------------------------------------------------------------------

describe("GET /me/orgs/:orgId", () => {
  test("no forwarded token → 404 org_not_found, no fetch", async () => {
    withToken = false;
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("org_not_found");
    expect(fetchCalls).toEqual([]);
  });

  test("token + upstream 200 → mapped row, bearer forwarded", async () => {
    withToken = true;
    fetchResponder = () =>
      new Response(
        JSON.stringify({
          user_id: "org-owner",
          display_name: "Org X Display",
          avatar_url: "https://avatar.x.test/o.png",
        }),
        { status: 200 },
      );
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { userId: string; displayName: string; avatarUrl: string | null };
    };
    expect(json.data).toEqual({
      userId: "org-owner",
      displayName: "Org X Display",
      avatarUrl: "https://avatar.x.test/o.png",
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${BASE_URL}/api/v1/orgs/org-x`);
    expect(fetchCalls[0]!.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
  });

  test("token + upstream 200 with missing fields → id + null fallbacks", async () => {
    withToken = true;
    fetchResponder = () => new Response(JSON.stringify({}), { status: 200 });
    const res = await app.request("/me/orgs/org-fallback");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { userId: string; displayName: string; avatarUrl: string | null };
    };
    expect(json.data).toEqual({
      userId: "org-fallback",
      displayName: "org-fallback",
      avatarUrl: null,
    });
  });

  test("upstream 404 → 404 org_not_found", async () => {
    withToken = true;
    fetchResponder = () => new Response("", { status: 404 });
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("org_not_found");
  });

  test("upstream 403 → 404 org_not_found (existence not leaked)", async () => {
    withToken = true;
    fetchResponder = () => new Response("", { status: 403 });
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("org_not_found");
  });

  test("upstream 500 → 500 NYXID_ORG_LOOKUP_FAILED", async () => {
    withToken = true;
    fetchResponder = () => new Response("boom", { status: 500 });
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("NYXID_ORG_LOOKUP_FAILED");
  });

  test("upstream 200 with malformed body → 500 internal_error", async () => {
    // 2xx + non-JSON payload: `resp.ok` is true so the route skips the
    // 404/403/!ok guards and reaches `await resp.json()` (routes.ts:206),
    // which throws a SyntaxError. That bare error isn't an AppError, so the
    // onError mapper falls back to its 500 / internal_error defaults.
    withToken = true;
    fetchResponder = () => new Response("<html>not json</html>", { status: 200 });
    const res = await app.request("/me/orgs/org-x");
    expect(res.status).toBe(500);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("internal_error");
  });
});

// ---------------------------------------------------------------------------
// GET /me/nyxid-services
// ---------------------------------------------------------------------------

describe("GET /me/nyxid-services", () => {
  test("no token → synthetic services only, NyxID not called", async () => {
    withToken = false;
    extraServiceNames = ["Synthetic One", "Synthetic Two!"];
    const res = await app.request("/me/nyxid-services");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        items: Array<{
          id: string;
          slug: string;
          label: string;
          description: string;
          tier: string;
        }>;
      };
    };
    expect(serviceCallTokens).toEqual([]);
    expect(json.data.items).toEqual([
      { id: "synthetic:synthetic-one", slug: "synthetic-one", label: "Synthetic One", description: "", tier: "admin" },
      { id: "synthetic:synthetic-two", slug: "synthetic-two", label: "Synthetic Two!", description: "", tier: "admin" },
    ]);
  });

  test("token → public kept, own-private kept, foreign-private dropped, tier mapped, synthetic last", async () => {
    withToken = true;
    extraServiceNames = ["Synthetic One"];
    catalogServices = [
      { id: "s-pub", slug: "pub", label: "Public Svc", description: "d1", visibility: "public", createdBy: "someone-else", isActive: true },
      { id: "s-own", slug: "own", label: "Own Private", description: null, visibility: "private", createdBy: "caller1", isActive: true },
      { id: "s-foreign", slug: "foreign", label: "Foreign Private", description: "d3", visibility: "private", createdBy: "other-user", isActive: true },
    ];
    const res = await app.request("/me/nyxid-services");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        items: Array<{ id: string; slug: string; label: string; description: string | null; tier: string }>;
      };
    };
    expect(serviceCallTokens).toEqual([FAKE_TOKEN]);
    expect(json.data.items).toEqual([
      { id: "s-pub", slug: "pub", label: "Public Svc", description: "d1", tier: "admin" },
      { id: "s-own", slug: "own", label: "Own Private", description: null, tier: "personal" },
      { id: "synthetic:synthetic-one", slug: "synthetic-one", label: "Synthetic One", description: "", tier: "admin" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// GET /me/skills/grants-summary  +  /me/shared-skills/sources-summary
//
// These two share the resolveOrgDisplayNames / resolveUserDisplayNames
// helpers. We exercise every branch of both helpers across the two
// endpoints — including BOTH arms of the userAccessToken gate.
// ---------------------------------------------------------------------------

describe("GET /me/skills/grants-summary", () => {
  test("no token → org id used as displayName (early return), users still resolved", async () => {
    withToken = false;
    grantsAgg = {
      orgs: [{ id: "org-a", skillCount: 3 }],
      users: [{ userId: "u-hit", skillCount: 2 }],
    };
    directoryRows = [{ userId: "u-hit", email: "hit@x.test", displayName: "Hit User" }];
    const res = await app.request("/me/skills/grants-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        orgs: Array<{ id: string; displayName: string; skillCount: number }>;
        users: Array<{ userId: string; email: string; displayName: string; skillCount: number }>;
      };
    };
    // No-token early return: org displayName falls back to the id, and
    // crucially NO fetch happens (forward_access_token contract).
    expect(fetchCalls).toEqual([]);
    expect(json.data.orgs).toEqual([{ id: "org-a", displayName: "org-a", skillCount: 3 }]);
    // User directory still consulted regardless of token: map hit → email/displayName.
    expect(json.data.users).toEqual([
      { userId: "u-hit", email: "hit@x.test", displayName: "Hit User", skillCount: 2 },
    ]);
  });

  test("token + upstream ok → org display_name; directory miss → raw id", async () => {
    withToken = true;
    grantsAgg = {
      orgs: [{ id: "org-named", skillCount: 1 }],
      users: [{ userId: "u-miss", skillCount: 4 }],
    };
    directoryRows = []; // miss
    fetchResponder = () =>
      new Response(JSON.stringify({ display_name: "Named Org" }), { status: 200 });
    const res = await app.request("/me/skills/grants-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        orgs: Array<{ id: string; displayName: string; skillCount: number }>;
        users: Array<{ userId: string; email: string; displayName: string; skillCount: number }>;
      };
    };
    // Token present → fetch happens with the forwarded bearer.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe(`${BASE_URL}/api/v1/orgs/org-named`);
    expect(fetchCalls[0]!.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(json.data.orgs).toEqual([{ id: "org-named", displayName: "Named Org", skillCount: 1 }]);
    // Directory miss → displayName/email fall back (email "", displayName raw id).
    expect(json.data.users).toEqual([
      { userId: "u-miss", email: "", displayName: "u-miss", skillCount: 4 },
    ]);
  });

  test("token + upstream not-ok → org id fallback", async () => {
    withToken = true;
    grantsAgg = { orgs: [{ id: "org-500", skillCount: 1 }], users: [] };
    fetchResponder = () => new Response("nope", { status: 502 });
    const res = await app.request("/me/skills/grants-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { orgs: Array<{ id: string; displayName: string; skillCount: number }> };
    };
    expect(json.data.orgs).toEqual([{ id: "org-500", displayName: "org-500", skillCount: 1 }]);
  });

  test("token + fetch throws → catch branch, org id fallback", async () => {
    withToken = true;
    grantsAgg = { orgs: [{ id: "org-throw", skillCount: 7 }], users: [] };
    fetchResponder = () => {
      throw new Error("network down");
    };
    const res = await app.request("/me/skills/grants-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { orgs: Array<{ id: string; displayName: string; skillCount: number }> };
    };
    expect(json.data.orgs).toEqual([{ id: "org-throw", displayName: "org-throw", skillCount: 7 }]);
  });

  test("directory hit → email + displayName surfaced verbatim", async () => {
    withToken = false;
    grantsAgg = { orgs: [], users: [{ userId: "u-named", skillCount: 1 }] };
    directoryRows = [
      { userId: "u-named", email: "named@x.test", displayName: "Named User" },
    ];
    const res = await app.request("/me/skills/grants-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        users: Array<{ userId: string; email: string; displayName: string; skillCount: number }>;
      };
    };
    expect(json.data.users).toEqual([
      { userId: "u-named", email: "named@x.test", displayName: "Named User", skillCount: 1 },
    ]);
  });
});

describe("GET /me/shared-skills/sources-summary", () => {
  test("token + populated → orgs resolved via fetch, users via directory", async () => {
    withToken = true;
    mountOrgGetter = true;
    orgMemberships = [{ userId: "bridge-org", role: "member", displayName: "Bridge" }];
    sourcesAgg = {
      orgs: [{ id: "bridge-org", skillCount: 2 }],
      users: [{ userId: "author1", skillCount: 5 }],
    };
    directoryRows = [{ userId: "author1", email: "author@x.test", displayName: "Author One" }];
    fetchResponder = () =>
      new Response(JSON.stringify({ display_name: "Bridge Org" }), { status: 200 });
    const res = await app.request("/me/shared-skills/sources-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        orgs: Array<{ id: string; displayName: string; skillCount: number }>;
        users: Array<{ userId: string; email: string; displayName: string; skillCount: number }>;
      };
    };
    expect(json.data.orgs).toEqual([{ id: "bridge-org", displayName: "Bridge Org", skillCount: 2 }]);
    expect(json.data.users).toEqual([
      { userId: "author1", email: "author@x.test", displayName: "Author One", skillCount: 5 },
    ]);
    // Scope-query bridge: the mounted org getter's membership ids are
    // projected by readUserOrgIds and forwarded as the 2nd arg so the
    // aggregation includes skills shared into the caller's orgs.
    expect(sourcesReaderOrgIds).toEqual([["bridge-org"]]);
  });

  test("no token + empty aggregation → empty buckets, no fetch", async () => {
    withToken = false;
    sourcesAgg = { orgs: [], users: [] };
    const res = await app.request("/me/shared-skills/sources-summary");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { orgs: unknown[]; users: unknown[] } };
    expect(fetchCalls).toEqual([]);
    expect(json.data.orgs).toEqual([]);
    expect(json.data.users).toEqual([]);
    // findByUserIds still called with an empty list (helper always batches).
    expect(directoryQueries).toEqual([[]]);
    // Org getter unmounted → readUserOrgIds fails soft to []; the route
    // passes an empty scope so the aggregation never over-shares.
    expect(sourcesReaderOrgIds).toEqual([[]]);
  });
});
