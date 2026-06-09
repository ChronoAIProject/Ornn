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
}

function buildApp(opts: BuildOpts = {}) {
  const { authenticated = true, userId = OWNER, permissions = [], service = {} } = opts;
  const config: SkillsetRoutesConfig = {
    skillsetService: fakeService(service),
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
          return [{ guid: "g-a", name: "a", version: "1.0", depth: 0 }];
        },
        getSkillset: async () => {
          calls.push("getSkillset");
          return detail();
        },
      },
    });
    const res = await app.request("/api/v1/skillsets/review-set/closure");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: unknown[] } };
    expect(body.data.items).toHaveLength(1);
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
  test("200 for a public skillset (anon)", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkillset: async () => detail({ isPrivate: false }) },
    });
    const res = await app.request("/api/v1/skillsets/review-set");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("review-set");
  });

  test("404 for a private skillset to anon (no leak)", async () => {
    const app = buildApp({
      authenticated: false,
      service: { getSkillset: async () => detail({ isPrivate: true, createdBy: "someone" }) },
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
      body: JSON.stringify({ version: "1.1", members: ["a@1.0", "b@1.0"] }),
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
});
