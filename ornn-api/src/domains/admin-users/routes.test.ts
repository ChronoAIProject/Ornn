/**
 * Admin-users routes — mount + dispatch tests (#877).
 *
 * Dependency-injected fake `AdminUsersService` — NO MongoDB. The route is
 * the unit under test: role defaulting + validation, page/pageSize
 * clamping, the `q` trim→undefined elision, and the
 * `exactOptionalPropertyTypes` conditional spread that must NOT pass
 * `q`/`sort`/`dir` keys to the service when they're absent.
 *
 * Harness mirrors `domains/admin/quota/routes.test.ts`: synthetic auth
 * middleware reading `x-test-perms`, an `onError` rendering RFC 7807
 * problem+json via `buildProblemJsonBody`, and `app.request()` dispatch.
 *
 * The admin permission is imported from the real export
 * (`QUOTA_ADMIN_PERMISSION`) rather than hardcoded so this test tracks
 * the route's gate if the constant ever changes.
 *
 * @module domains/admin-users/routes.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { QUOTA_ADMIN_PERMISSION } from "../quota/types";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createAdminUsersRoutes } from "./routes";
import type { AdminUsersService, ListUsersParams } from "./service";

/** Captured params the route handed the service. */
let listCalls: ListUsersParams[];
let app: Hono<{ Variables: AuthVariables }>;

/**
 * Throwing-proxy DI fake — `listUsers` is the only legitimate access.
 * Returns a fixed empty page so the route's response envelope is exercised.
 */
function makeService(): AdminUsersService {
  const impl: Partial<AdminUsersService> = {
    async listUsers(params: ListUsersParams) {
      listCalls.push(params);
      return { items: [], page: params.page, pageSize: params.pageSize, total: 0, totalPages: 1 };
    },
  };
  return new Proxy(impl as AdminUsersService, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`adminUsersService.${String(prop)} accessed but not faked`);
    },
  });
}

function authHeaders(perms: string[] = [QUOTA_ADMIN_PERMISSION]) {
  return { "x-test-perms": perms.join(",") };
}

beforeEach(() => {
  listCalls = [];
  const router = createAdminUsersRoutes({ adminUsersService: makeService() });
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

describe("GET /admin/users", () => {
  test("default role=normal + no optional keys passed through", async () => {
    const res = await app.request("/admin/users", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total: number }; error: null };
    expect(json.error).toBeNull();
    expect(json.data.total).toBe(0);
    expect(listCalls).toHaveLength(1);
    const call = listCalls[0]!;
    expect(call.role).toBe("normal"); // default
    expect(call.page).toBe(1);
    expect(call.pageSize).toBe(20);
    // exactOptionalPropertyTypes: absent optionals are NOT spread in.
    expect("q" in call).toBe(false);
    expect("sort" in call).toBe(false);
    expect("dir" in call).toBe(false);
  });

  test("role=admin is forwarded", async () => {
    const res = await app.request("/admin/users?role=admin", { headers: authHeaders() });
    expect(res.status).toBe(200);
    expect(listCalls[0]!.role).toBe("admin");
  });

  test("invalid role → 400 invalid_role; service not called", async () => {
    const res = await app.request("/admin/users?role=superuser", { headers: authHeaders() });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("invalid_role");
    expect(listCalls.length).toBe(0);
  });

  test("pageSize clamps to ≤ 200; page floors at ≥ 1", async () => {
    const res = await app.request("/admin/users?page=0&pageSize=5000", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(listCalls[0]!.page).toBe(1);
    expect(listCalls[0]!.pageSize).toBe(200);
  });

  test("q whitespace-only trims to undefined and is elided", async () => {
    const res = await app.request(`/admin/users?q=${encodeURIComponent("   ")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect("q" in listCalls[0]!).toBe(false);
  });

  test("q with content is trimmed and forwarded", async () => {
    const res = await app.request(`/admin/users?q=${encodeURIComponent("  alice  ")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(listCalls[0]!.q).toBe("alice");
  });

  test("sort + dir parse via zod and are forwarded", async () => {
    const res = await app.request("/admin/users?sort=skillCount&dir=asc", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(listCalls[0]!.sort).toBe("skillCount");
    expect(listCalls[0]!.dir).toBe("asc");
  });

  test("invalid sort currently escapes as 500 internal_error (KNOWN DEFECT — should be 400; tracked in #908)", async () => {
    // Documents current buggy behavior: the route calls raw `sortKeySchema.parse`
    // (and `dirSchema.parse`) on the `sort`/`dir` query params. A bad value makes
    // zod throw a ZodError, which carries no `statusCode`/`code`, so it escapes to
    // the bootstrap's non-AppError→500 mapper instead of being a client error.
    // Target fix: mirror the `role` param's `safeParse` guard and raise a 400
    // `invalid_sort` / `invalid_dir` AppError. Until that lands we pin the
    // current 500 so the regression is visible and the fix flips this assertion.
    const res = await app.request("/admin/users?sort=bogusColumn", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    expect(listCalls.length).toBe(0);
  });

  test("403 when admin perm missing — listUsers never called", async () => {
    const res = await app.request("/admin/users", { headers: authHeaders([]) });
    expect(res.status).toBe(403);
    expect(listCalls.length).toBe(0);
  });
});
