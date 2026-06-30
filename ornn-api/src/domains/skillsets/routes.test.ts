/**
 * Route-level tests for the skillset CRUD + closure routes (#969).
 *
 * Mounts the real `createSkillsetRoutes` on a bare Hono app with a Proxy
 * fake service (un-asserted methods throw). Pins:
 *   - closure resolves before :idOrName (literal segment wins)
 *   - 409 conflict surfaces with the right code
 *   - 404 unknown skillset
 *   - 403 scope-denied (missing ornn:skill:* scope)
 *   - permission scopes REUSE ornn:skill:* (not ornn:skillset:*)
 *
 * @module domains/skillsets/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSkillsetRoutes, type SkillsetRoutesConfig } from "./routes";
import { AppError, buildProblemJsonBody } from "../../shared/types/index";
import { __resetRateLimitForTests } from "../../middleware/rateLimit";

const CREATE = "ornn:skill:create";
const UPDATE = "ornn:skill:update";
const DELETE = "ornn:skill:delete";
const OWNER = "owner-1";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    guid: "ss-1",
    name: "review-set",
    description: "a set",
    instructions: "Run member a, then feed its output to member b.",
    kind: "generic",
    tags: [],
    members: ["a@1.0", "b@1.0"],
    version: "1.0",
    latestVersion: "1.0",
    isPrivate: false,
    createdBy: OWNER,
    sharedWithUsers: [],
    sharedWithOrgs: [],
    createdOn: "2026-01-01T00:00:00Z",
    updatedOn: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function fakeService(impl: Record<string, (...args: unknown[]) => unknown>) {
  return new Proxy(impl, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (..._args: unknown[]) => {
        throw new Error(`skillsetService.${prop} should not be called in this test`);
      };
    },
  }) as unknown as SkillsetRoutesConfig["skillsetService"];
}

interface BuildOpts {
  authenticated?: boolean;
  userId?: string;
  permissions?: string[];
  service?: Record<string, (...args: unknown[]) => unknown>;
  /** #1155 — capture mirror-reconcile triggers fired by mutation routes. */
  fireMirrorReconcile?: () => void;
}

function buildApp(opts: BuildOpts = {}) {
  const { authenticated = true, userId = OWNER, permissions = [], service = {} } = opts;
  const config: SkillsetRoutesConfig = {
    skillsetService: fakeService(service),
    ...(opts.fireMirrorReconcile ? { fireMirrorReconcile: opts.fireMirrorReconcile } : {}),
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
  app.route("/api/v1", createSkillsetRoutes(config));
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

describe("GET /skillsets/:idOrName/closure", () => {
  test("the literal /closure segment wins over :idOrName", async () => {
    const calls: string[] = [];
    const app = buildApp({
      authenticated: false,
      service: {
        resolveClosure: async () => {
          calls.push("resolveClosure");
          return {
            instructions: "master prompt for the set",
            items: [{ guid: "g-a", name: "a", version: "1.0", depth: 0 }],
          };
        },
        getSkillset: async () => {
          calls.push("getSkillset");
          return detail();
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/review-set/closure");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { instructions: string; items: unknown[] } };
    expect(body.data.items).toHaveLength(1);
    // The master prompt (#978) rides as a ROOT sibling of items.
    expect(body.data.instructions).toBe("master prompt for the set");
    // Only resolveClosure ran — :idOrName's getSkillset was NOT reached.
    expect(calls).toEqual(["resolveClosure"]);
  });

  test("409 dependency_conflict surfaces from the resolver", async () => {
    const app = buildApp({
      authenticated: false,
      service: {
        resolveClosure: async () => {
          throw AppError.conflict("dependency_conflict", "two versions of x");
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/review-set/closure");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("dependency_conflict");
  });

  test("404 unknown skillset", async () => {
    const app = buildApp({
      authenticated: false,
      service: {
        resolveClosure: async () => {
          throw AppError.notFound("skillset_not_found", "nope");
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/ghost/closure");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("skillset_not_found");
  });
});

describe("GET /skillsets/:idOrName", () => {
  test("200 when the member-derived gate admits the caller (#1136)", async () => {
    // The route delegates the whole read decision to getSkillsetForRead;
    // here the service admits the caller and returns the detail.
    const app = buildApp({
      authenticated: false,
      service: {
        getSkillsetForRead: async () => detail({ memberVisibilityState: "all-public", unreadableMembers: [] }),
      },
    });
    const res = await app.request("/api/v1/skillsets/review-set");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; memberVisibilityState: string } };
    expect(body.data.name).toBe("review-set");
    expect(body.data.memberVisibilityState).toBe("all-public");
  });

  test("404 when the member-derived gate denies the caller (no leak, #1136)", async () => {
    // A caller who can't read every member gets a flat skillset_not_found
    // from the service — the route just surfaces it.
    const app = buildApp({
      authenticated: false,
      service: {
        getSkillsetForRead: async () => {
          throw AppError.notFound("skillset_not_found", "Skillset 'secret-set' not found");
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/secret-set");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("skillset_not_found");
  });
});

describe("POST /skillsets — scope reuse + gating", () => {
  test("401 unauthenticated", async () => {
    const app = buildApp({ authenticated: false });
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", description: "d", members: ["a@1.0", "b@1.0"] }),
    });
    expect(res.status).toBe(401);
  });

  test("403 without ornn:skill:create (scope reuse, NOT ornn:skillset:*)", async () => {
    const app = buildApp({ permissions: ["ornn:skill:read"] });
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", description: "d", members: ["a@1.0", "b@1.0"] }),
    });
    expect(res.status).toBe(403);
  });

  test("201 + Location with ornn:skill:create", async () => {
    const app = buildApp({
      permissions: [CREATE],
      service: { createSkillset: async () => detail({ guid: "ss-new", isPrivate: true }) },
    });
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "review-set",
        description: "d",
        instructions: "Use a, then b.",
        members: ["a@1.0", "b@1.0"],
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe("/api/v1/skillsets/ss-new");
  });

  test("400 on fewer than 2 members", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "review-set", description: "d", members: ["a@1.0"] }),
    });
    expect(res.status).toBe(400);
  });

  test("fires the mirror reconcile after a successful create (#1155)", async () => {
    let fired = 0;
    const app = buildApp({
      permissions: [CREATE],
      service: { createSkillset: async () => detail({ guid: "ss-new" }) },
      fireMirrorReconcile: () => {
        fired += 1;
      },
    });
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "review-set",
        description: "d",
        instructions: "Use a, then b.",
        members: ["a@1.0", "b@1.0"],
      }),
    });
    expect(res.status).toBe(201);
    expect(fired).toBe(1);
  });

  test("does NOT fire the mirror reconcile when create is rejected (#1155)", async () => {
    let fired = 0;
    const app = buildApp({
      permissions: [CREATE],
      fireMirrorReconcile: () => {
        fired += 1;
      },
    });
    // Invalid body (1 member) → 400 before the handler body runs.
    const res = await app.request("/api/v1/skillsets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "review-set", description: "d", members: ["a@1.0"] }),
    });
    expect(res.status).toBe(400);
    expect(fired).toBe(0);
  });
});

describe("PUT/DELETE /skillsets/:id — scope gating", () => {
  test("PUT 403 without ornn:skill:update", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skillsets/ss-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.1", members: ["a@1.0", "b@1.0"] }),
    });
    expect(res.status).toBe(403);
  });

  test("PUT 200 with ornn:skill:update", async () => {
    const app = buildApp({
      permissions: [UPDATE],
      service: { publishVersion: async () => detail({ version: "1.1", latestVersion: "1.1" }) },
    });
    const res = await app.request("/api/v1/skillsets/ss-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "1.1",
        instructions: "Use a, then b.",
        members: ["a@1.0", "b@1.0"],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { version: string } }).data.version).toBe("1.1");
  });

  test("DELETE 403 without ornn:skill:delete", async () => {
    const app = buildApp({ permissions: [UPDATE] });
    const res = await app.request("/api/v1/skillsets/ss-1", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("DELETE 200 with ornn:skill:delete", async () => {
    const app = buildApp({
      permissions: [DELETE],
      service: { deleteSkillset: async () => undefined },
    });
    const res = await app.request("/api/v1/skillsets/ss-1", { method: "DELETE" });
    expect(res.status).toBe(200);
  });

  test("PUT /plugin-export 403 without ornn:skill:update (#1157)", async () => {
    const app = buildApp({ permissions: [CREATE] });
    const res = await app.request("/api/v1/skillsets/ss-1/plugin-export", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  test("PUT /plugin-export 400 on an invalid body (missing enabled) (#1157)", async () => {
    const app = buildApp({ permissions: [UPDATE] });
    const res = await app.request("/api/v1/skillsets/ss-1/plugin-export", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "x" }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /plugin-export 200 updates + fires the mirror reconcile (#1157)", async () => {
    let fired = 0;
    const captured: unknown[] = [];
    const app = buildApp({
      permissions: [UPDATE],
      service: {
        setPluginExport: async (...args: unknown[]) => {
          captured.push(args[1]);
          return detail({ exportAsPlugin: true });
        },
      },
      fireMirrorReconcile: () => {
        fired += 1;
      },
    });
    const res = await app.request("/api/v1/skillsets/ss-1/plugin-export", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        displayName: "Research Bundle",
        keywords: ["rag"],
      }),
    });
    expect(res.status).toBe(200);
    expect(fired).toBe(1);
    expect(((await res.json()) as { data: { exportAsPlugin: boolean } }).data.exportAsPlugin).toBe(true);
    expect(captured[0]).toEqual({ enabled: true, displayName: "Research Bundle", keywords: ["rag"] });
  });

  test("PUT /plugin-export surfaces a 409 when too few public members (#1157/#1161)", async () => {
    const app = buildApp({
      permissions: [UPDATE],
      service: {
        setPluginExport: async () => {
          throw AppError.conflict("skillset_too_few_public_members", "needs ≥2 public members");
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/ss-1/plugin-export", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("skillset_too_few_public_members");
  });

  test("PUT + DELETE fire the mirror reconcile on success (#1155)", async () => {
    let fired = 0;
    const fireMirrorReconcile = () => {
      fired += 1;
    };
    const putApp = buildApp({
      permissions: [UPDATE],
      service: { publishVersion: async () => detail({ version: "1.1" }) },
      fireMirrorReconcile,
    });
    await putApp.request("/api/v1/skillsets/ss-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: "1.1", instructions: "Use a, then b.", members: ["a@1.0", "b@1.0"] }),
    });
    const delApp = buildApp({
      permissions: [DELETE],
      service: { deleteSkillset: async () => undefined },
      fireMirrorReconcile,
    });
    await delApp.request("/api/v1/skillsets/ss-1", { method: "DELETE" });
    expect(fired).toBe(2);
  });

  test("transfer-ownership 403 without ornn:skill:update", async () => {
    const app = buildApp({ permissions: [] });
    const res = await app.request("/api/v1/skillsets/ss-1/transfer-ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newOwnerUserId: "alice" }),
    });
    expect(res.status).toBe(403);
  });

  test("transfer-ownership 200 delegating to the service + firing the mirror reconcile (#1159)", async () => {
    const calls: string[] = [];
    let fired = 0;
    const app = buildApp({
      permissions: [UPDATE],
      service: {
        transferOwnership: async () => {
          calls.push("transferOwnership");
          return { guid: "ss-1", createdBy: "alice" };
        },
      },
      fireMirrorReconcile: () => {
        fired += 1;
      },
    });
    const res = await app.request("/api/v1/skillsets/ss-1/transfer-ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newOwnerUserId: "alice" }),
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["transferOwnership"]);
    // #1159 — the transfer now reconciles the mirror, matching the skill path.
    expect(fired).toBe(1);
  });

  test("transfer-ownership does NOT fire the mirror reconcile when rejected (#1159)", async () => {
    let fired = 0;
    const app = buildApp({
      permissions: [UPDATE],
      service: {
        transferOwnership: async () => {
          throw AppError.forbidden("forbidden", "only the owner may transfer");
        },
      },
      fireMirrorReconcile: () => {
        fired += 1;
      },
    });
    const res = await app.request("/api/v1/skillsets/ss-1/transfer-ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newOwnerUserId: "alice" }),
    });
    expect(res.status).toBe(403);
    expect(fired).toBe(0);
  });

  test("transfer-ownership 400 on a missing newOwnerUserId", async () => {
    const app = buildApp({ permissions: [UPDATE] });
    const res = await app.request("/api/v1/skillsets/ss-1/transfer-ownership", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
