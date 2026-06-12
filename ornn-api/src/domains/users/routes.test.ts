/**
 * User-directory routes — mount + dispatch tests (#878).
 *
 * Dependency-injected fake `UserDirectoryRepository` — NO MongoDB. The
 * routes are the unit under test: query validation + defaulting on
 * `/users/search`, and the CSV id parsing (trim / filter-empty /
 * empty-short-circuit) on `/users/resolve`.
 *
 * Harness mirrors `domains/redemption-codes/me-routes.test.ts`:
 * synthetic auth middleware setting `c.set("auth", ...)`, an `onError`
 * rendering RFC 7807 problem+json via `buildProblemJsonBody`, and
 * `app.request()` dispatch.
 *
 * @module domains/users/routes.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createUserRoutes } from "./routes";
import type { UserDirectoryRepository } from "./repository";

/** Captured calls the route handed the repository. */
let searchCalls: Array<{ prefix: string; limit: number }>;
let resolveCalls: Array<readonly string[]>;
let app: Hono<{ Variables: AuthVariables }>;

type DirectoryRow = { userId: string; email: string; displayName: string };

/**
 * Throwing-proxy DI fake — only `searchByEmailPrefix` + `findByUserIds`
 * are legitimate accesses. Any other property access (a route reaching
 * for an unstubbed method) throws loudly so the test fails fast rather
 * than silently exercising a Mongo-backed path.
 */
function makeRepo(): UserDirectoryRepository {
  const impl: Partial<UserDirectoryRepository> = {
    async searchByEmailPrefix(prefix: string, limit: number): Promise<DirectoryRow[]> {
      searchCalls.push({ prefix, limit });
      return [{ userId: "u1", email: "u1@x.test", displayName: "User One" }];
    },
    async findByUserIds(ids: readonly string[]): Promise<DirectoryRow[]> {
      resolveCalls.push(ids);
      return ids.map((id) => ({ userId: id, email: `${id}@x.test`, displayName: id }));
    },
  };
  return new Proxy(impl as UserDirectoryRepository, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`userDirectoryRepo.${String(prop)} accessed but not faked`);
    },
  });
}

beforeEach(() => {
  searchCalls = [];
  resolveCalls = [];
  const router = createUserRoutes({ userDirectoryRepo: makeRepo() });
  app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      userId: "caller1",
      email: "caller@x.test",
      displayName: "Caller",
      roles: [],
      permissions: [],
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

describe("GET /users/search", () => {
  test("happy path → forwards q + limit to searchByEmailPrefix", async () => {
    const res = await app.request("/users/search?q=use&limit=5");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: DirectoryRow[] };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data.items).toEqual([
      { userId: "u1", email: "u1@x.test", displayName: "User One" },
    ]);
    expect(searchCalls).toEqual([{ prefix: "use", limit: 5 }]);
  });

  test("limit out of range → 400 invalid_query, repo not called", async () => {
    const res = await app.request("/users/search?limit=999");
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; status: number };
    expect(json.code).toBe("invalid_query");
    expect(searchCalls).toEqual([]);
  });

  test("defaults — no q / no limit → empty prefix + limit 10", async () => {
    const res = await app.request("/users/search");
    expect(res.status).toBe(200);
    expect(searchCalls).toEqual([{ prefix: "", limit: 10 }]);
  });
});

describe("GET /users/resolve", () => {
  test("absent ids param → empty items, repo NOT called", async () => {
    const res = await app.request("/users/resolve");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(resolveCalls).toEqual([]);
  });

  test("empty ids param → empty items, repo NOT called", async () => {
    const res = await app.request("/users/resolve?ids=");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(resolveCalls).toEqual([]);
  });

  test("all-blank ids param → empty items, repo NOT called", async () => {
    const res = await app.request("/users/resolve?ids=" + encodeURIComponent(" , ,  "));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(resolveCalls).toEqual([]);
  });

  test("csv trim + filter-empty — ' a , ,b ' → ['a','b'] + happy resolve", async () => {
    const res = await app.request("/users/resolve?ids=" + encodeURIComponent(" a , ,b "));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(resolveCalls).toEqual([["a", "b"]]);
    expect(json.data.items).toEqual([
      { userId: "a", email: "a@x.test", displayName: "a" },
      { userId: "b", email: "b@x.test", displayName: "b" },
    ]);
  });
});
