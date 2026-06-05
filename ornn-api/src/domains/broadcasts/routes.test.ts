/**
 * Broadcast admin routes tests (#882).
 *
 * Mounts `createBroadcastRoutes` on a bare Hono app — the real
 * `requirePermission("ornn:admin:skill")` gate is exercised by toggling
 * an `x-test-perms` header in a setup middleware (harness cloned from
 * `admin/quota/routes.test.ts`). The `BroadcastService` is a throwing
 * Proxy so any unexpected method call is a loud failure; the handful of
 * methods each test needs are stubbed per-case.
 *
 * Covers, for each of the four handlers:
 *   - the no-permission → 403 path through the real gate;
 *   - POST 201 + Location header + `recipientUserIds` conditional spread
 *     (present / absent arms);
 *   - POST / PATCH invalid-body → 400 `invalid_broadcast_input`;
 *   - PATCH `titleI18n` / `bodyMarkdownI18n` conditional-spread arms;
 *   - DELETE → `{ data: { id } }`.
 *
 * @module domains/broadcasts/routes.test
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createBroadcastRoutes } from "./routes";
import type { BroadcastService } from "./service";
import type { AdminBroadcastResponse } from "./types";

const ADMIN_PERM = "ornn:admin:skill";

/**
 * Throwing Proxy: every property access blows up unless the test
 * overrides it via `Object.assign`. Keeps the fake honest — a route
 * touching an unexpected service method surfaces immediately instead of
 * silently returning `undefined`.
 */
function fakeService(overrides: Partial<BroadcastService>): BroadcastService {
  const target = { ...overrides } as Record<string, unknown>;
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      throw new Error(`unexpected BroadcastService.${String(prop)} call`);
    },
  }) as unknown as BroadcastService;
}

function buildApp(service: BroadcastService) {
  const router = createBroadcastRoutes({ broadcastService: service });
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
    const body = buildProblemJsonBody({
      statusCode,
      code: e.code ?? "internal_error",
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

function authHeaders(perms: string[] = [ADMIN_PERM]) {
  return { "content-type": "application/json", "x-test-perms": perms.join(",") };
}

function sampleResponse(over: Partial<AdminBroadcastResponse> = {}): AdminBroadcastResponse {
  return {
    id: "b-1",
    titleI18n: { en: "Hello", zh: "你好" },
    bodyMarkdownI18n: { en: "Body", zh: "正文" },
    createdBy: "admin1",
    updatedBy: "admin1",
    recipientUserIds: null,
    createdAt: "2026-06-05T00:00:00.000Z",
    updatedAt: "2026-06-05T00:00:00.000Z",
    readCount: 0,
    ...over,
  };
}

const validCreateBody = {
  titleI18n: { en: "Hello", zh: "你好" },
  bodyMarkdownI18n: { en: "Body", zh: "正文" },
};

describe("broadcast routes — permission gate (real requirePermission)", () => {
  test("GET without admin perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/broadcasts", { headers: authHeaders([]) });
    expect(res.status).toBe(403);
  });

  test("POST without admin perm → 403, service untouched", async () => {
    let createCalls = 0;
    const app = buildApp(
      fakeService({
        create: async () => {
          createCalls++;
          return sampleResponse();
        },
      }),
    );
    const res = await app.request("/admin/broadcasts", {
      method: "POST",
      headers: authHeaders([]),
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(403);
    expect(createCalls).toBe(0);
  });

  test("PATCH without admin perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/broadcasts/b-1", {
      method: "PATCH",
      headers: authHeaders([]),
      body: JSON.stringify({ titleI18n: { en: "x", zh: "x" } }),
    });
    expect(res.status).toBe(403);
  });

  test("DELETE without admin perm → 403", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/broadcasts/b-1", {
      method: "DELETE",
      headers: authHeaders([]),
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/broadcasts", () => {
  test("returns the service list under data.items", async () => {
    const app = buildApp(
      fakeService({ listAdmin: async () => [sampleResponse()] }),
    );
    const res = await app.request("/admin/broadcasts", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: AdminBroadcastResponse[] } };
    expect(json.data.items).toHaveLength(1);
    expect(json.data.items[0]!.id).toBe("b-1");
  });
});

describe("POST /admin/broadcasts", () => {
  test("201 + Location + everyone broadcast (recipientUserIds spread absent)", async () => {
    let captured: unknown;
    const app = buildApp(
      fakeService({
        create: async (params) => {
          captured = params;
          return sampleResponse({ id: "b-new" });
        },
      }),
    );
    const res = await app.request("/admin/broadcasts", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(validCreateBody),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Location")).toBe("/api/v1/admin/broadcasts/b-new");
    const json = (await res.json()) as { data: AdminBroadcastResponse };
    expect(json.data.id).toBe("b-new");
    // No recipientUserIds key in the body → service params omit it (the
    // `...(data.recipientUserIds !== undefined ? ... : {})` falsy arm).
    expect("recipientUserIds" in (captured as Record<string, unknown>)).toBe(false);
  });

  test("201 with targeted recipients (recipientUserIds spread present)", async () => {
    let captured: { recipientUserIds?: readonly string[] } = {};
    const app = buildApp(
      fakeService({
        create: async (params) => {
          captured = params;
          return sampleResponse({ recipientUserIds: ["u-1", "u-2"] });
        },
      }),
    );
    const res = await app.request("/admin/broadcasts", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ ...validCreateBody, recipientUserIds: ["u-1", "u-2"] }),
    });
    expect(res.status).toBe(201);
    expect(captured.recipientUserIds).toEqual(["u-1", "u-2"]);
  });

  test("invalid body → 400 invalid_broadcast_input", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/broadcasts", {
      method: "POST",
      headers: authHeaders(),
      // Missing bodyMarkdownI18n → schema fails.
      body: JSON.stringify({ titleI18n: { en: "x", zh: "x" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_broadcast_input");
  });
});

describe("PATCH /admin/broadcasts/:id", () => {
  test("titleI18n-only patch passes only the title arm to the service", async () => {
    let captured: Record<string, unknown> = {};
    const app = buildApp(
      fakeService({
        update: async (_id, params) => {
          captured = params as unknown as Record<string, unknown>;
          return sampleResponse();
        },
      }),
    );
    const res = await app.request("/admin/broadcasts/b-1", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ titleI18n: { en: "New", zh: "新" } }),
    });
    expect(res.status).toBe(200);
    expect(captured.titleI18n).toEqual({ en: "New", zh: "新" });
    expect("bodyMarkdownI18n" in captured).toBe(false);
    expect(captured.updatedBy).toBe("admin1");
  });

  test("bodyMarkdownI18n-only patch passes only the body arm to the service", async () => {
    let captured: Record<string, unknown> = {};
    const app = buildApp(
      fakeService({
        update: async (_id, params) => {
          captured = params as unknown as Record<string, unknown>;
          return sampleResponse();
        },
      }),
    );
    const res = await app.request("/admin/broadcasts/b-1", {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ bodyMarkdownI18n: { en: "New body", zh: "新正文" } }),
    });
    expect(res.status).toBe(200);
    expect(captured.bodyMarkdownI18n).toEqual({ en: "New body", zh: "新正文" });
    expect("titleI18n" in captured).toBe(false);
  });

  test("invalid body → 400 invalid_broadcast_input", async () => {
    const app = buildApp(fakeService({}));
    const res = await app.request("/admin/broadcasts/b-1", {
      method: "PATCH",
      headers: authHeaders(),
      // Empty patch fails the schema's "at least one field" refinement.
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_broadcast_input");
  });
});

describe("DELETE /admin/broadcasts/:id", () => {
  test("returns { data: { id } }", async () => {
    let deletedId: string | undefined;
    const app = buildApp(
      fakeService({
        delete: async (id) => {
          deletedId = id;
        },
      }),
    );
    const res = await app.request("/admin/broadcasts/b-9", {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe("b-9");
    expect(deletedId).toBe("b-9");
  });
});
