/**
 * Route tests for GET /skillset-search (#969).
 *
 * Pins: kind narrows (param forwarded), tags forwarded, anon collapses to
 * public scope, cursor pagination decoded.
 *
 * @module domains/skillsets/search/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSkillsetSearchRoutes, type SkillsetSearchRoutesConfig } from "./routes";
import { buildProblemJsonBody } from "../../../shared/types/index";
import { __resetRateLimitForTests } from "../../../middleware/rateLimit";

interface SearchCall {
  scope: string;
  kind?: string;
  tagsAll?: string[];
  page: number;
  pageSize: number;
  currentUserId: string;
}

function buildApp(opts: {
  authenticated?: boolean;
  capture?: (call: SearchCall) => void;
  total?: number;
  itemCount?: number;
}) {
  const { authenticated = false, capture = () => {}, total = 0, itemCount = 0 } = opts;
  const skillsetSearchService = {
    search: async (params: SearchCall) => {
      capture(params);
      return {
        items: Array.from({ length: itemCount }, (_, i) => ({
          guid: `g${i}`,
          name: `s${i}`,
          description: "",
          kind: "generic",
          tags: [],
          memberCount: 0,
          latestVersion: "1.0",
          isPrivate: false,
          createdBy: "o",
          createdOn: "2026-01-01T00:00:00Z",
          updatedOn: "2026-01-01T00:00:00Z",
        })),
        total,
        page: params.page,
        pageSize: params.pageSize,
        totalPages: Math.ceil(total / params.pageSize),
      };
    },
  } as unknown as SkillsetSearchRoutesConfig["skillsetSearchService"];

  const app = new Hono();
  if (authenticated) {
    app.use("*", async (c, next) => {
      c.set("auth" as never, {
        userId: "u1",
        email: "u1@test.local",
        displayName: "u1",
        roles: [],
        permissions: [],
      } as never);
      await next();
    });
  }
  app.route("/api/v1", createSkillsetSearchRoutes({ skillsetSearchService }));
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return c.json(
      buildProblemJsonBody({ statusCode: status, code, message: err.message, instance: c.req.path, requestId: null }),
      status as never,
      { "Content-Type": "application/problem+json" },
    );
  });
  return app;
}

beforeEach(() => __resetRateLimitForTests());
afterEach(() => __resetRateLimitForTests());

describe("GET /skillset-search", () => {
  test("forwards kind to the service", async () => {
    let call: SearchCall | null = null;
    const app = buildApp({ capture: (c) => (call = c) });
    const res = await app.request("/api/v1/skillset-search?kind=consensus-supported");
    expect(res.status).toBe(200);
    expect(call!.kind).toBe("consensus-supported");
  });

  test("forwards tags as a CSV list (AND match)", async () => {
    let call: SearchCall | null = null;
    const app = buildApp({ capture: (c) => (call = c) });
    await app.request("/api/v1/skillset-search?tags=alpha,beta");
    expect(call!.tagsAll).toEqual(["alpha", "beta"]);
  });

  test("anonymous caller is collapsed to public scope", async () => {
    let call: SearchCall | null = null;
    const app = buildApp({ authenticated: false, capture: (c) => (call = c) });
    await app.request("/api/v1/skillset-search?scope=private");
    expect(call!.scope).toBe("public");
  });

  test("authenticated caller keeps the requested scope", async () => {
    let call: SearchCall | null = null;
    const app = buildApp({ authenticated: true, capture: (c) => (call = c) });
    await app.request("/api/v1/skillset-search?scope=mine");
    expect(call!.scope).toBe("mine");
    expect(call!.currentUserId).toBe("u1");
  });

  test("rejects an unknown kind with 400", async () => {
    const app = buildApp({});
    const res = await app.request("/api/v1/skillset-search?kind=bundle");
    expect(res.status).toBe(400);
  });

  test("emits a nextCursor when a full page is returned (pagination)", async () => {
    const app = buildApp({ total: 100, itemCount: 20 });
    const res = await app.request("/api/v1/skillset-search?pageSize=20");
    const body = (await res.json()) as { data: { meta: { hasMore: boolean; nextCursor?: string } } };
    expect(body.data.meta.hasMore).toBe(true);
    expect(typeof body.data.meta.nextCursor).toBe("string");
  });
});
