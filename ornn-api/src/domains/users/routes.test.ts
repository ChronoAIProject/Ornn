/**
 * User-directory route tests.
 *
 * Covers mount + dispatch (happy-path search, limit validation, resolve CSV
 * parsing — originally #878) AND enumeration hardening (#816):
 *   - empty / 1-char `q` is rejected at the validateQuery seam (400) and
 *     never reaches the repository (no DB hit, no directory walk).
 *   - a real ≥2-char prefix returns 200 and the email field stays in the
 *     response (the collaborator typeahead matches on email prefix).
 *   - both routes share ONE per-user rate-limit budget (`users-directory`
 *     label) — bursting either past the cap yields 429 with Retry-After
 *     and RateLimit-Remaining: 0; the limit is shared so an enumerator
 *     can't dodge the search cap by pivoting to resolve.
 *
 * The route module captures RL_MAX at import time as a module-level const.
 * In the full test suite the module is already cached by the time this file
 * runs, so the default (30) is always active. The burst tests read the
 * actual cap from the first response's RateLimit-Limit header rather than
 * relying on env-vars / dynamic imports.
 *
 * @module domains/users/routes.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError, buildProblemJsonBody } from "../../shared/types/index";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { __resetRateLimitForTests } from "../../middleware/rateLimit";
import { createUserRoutes } from "./routes";

// --- Types ------------------------------------------------------------
type DirectoryRow = { userId: string; email: string; displayName: string };

// --- Fake repository --------------------------------------------------
// Spy on searchByEmailPrefix so tests can assert it was (not) called.
interface SearchSpy {
  searchCalls: Array<{ prefix: string; limit: number }>;
  resolveCalls: Array<readonly string[]>;
}

function makeFakeRepo(): { repo: Parameters<typeof createUserRoutes>[0]["userDirectoryRepo"]; spy: SearchSpy } {
  const spy: SearchSpy = { searchCalls: [], resolveCalls: [] };
  const repo = {
    async searchByEmailPrefix(prefix: string, limit: number) {
      spy.searchCalls.push({ prefix, limit });
      return [
        {
          userId: "u1",
          email: "u1@x.test",
          displayName: "User One",
        },
      ];
    },
    async findByUserIds(ids: readonly string[]) {
      spy.resolveCalls.push(ids);
      return ids.map((id) => ({
        userId: id,
        email: `${id}@x.test`,
        displayName: id,
      }));
    },
  };
  return {
    repo: repo as unknown as Parameters<typeof createUserRoutes>[0]["userDirectoryRepo"],
    spy,
  };
}

// --- App harness ------------------------------------------------------
// Stub auth so the limiter's default keyBy resolves a per-user bucket,
// mount the real routes, and translate AppError → problem+json the way
// the global handler does.
function makeApp(repo: Parameters<typeof createUserRoutes>[0]["userDirectoryRepo"]) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    const userId = c.req.header("x-test-user") ?? "u1";
    c.set("auth" as never, { userId, email: `${userId}@x.test` } as never);
    await next();
  });
  app.route("/", createUserRoutes({ userDirectoryRepo: repo }));
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body = buildProblemJsonBody({
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        instance: c.req.path,
        requestId: null,
      });
      return c.json(body, err.statusCode as never, {
        "Content-Type": "application/problem+json",
      });
    }
    return c.json({ error: { code: "internal_error", message: String(err) } }, 500);
  });
  return app;
}

// ---------------------------------------------------------------------------
// Mount + dispatch tests (from #878, adapted for rate-limited routes)
// ---------------------------------------------------------------------------

describe("GET /users/search — mount + dispatch", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("happy path → forwards q + limit to searchByEmailPrefix", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/search?q=us&limit=5", {
      headers: { "x-test-user": "t1" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: DirectoryRow[] };
      error: null;
    };
    expect(json.error).toBeNull();
    expect(json.data.items).toEqual([
      { userId: "u1", email: "u1@x.test", displayName: "User One" },
    ]);
    expect(spy.searchCalls).toEqual([{ prefix: "us", limit: 5 }]);
  });

  test("limit out of range → 400 invalid_query, repo not called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/search?limit=999", {
      headers: { "x-test-user": "t2" },
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string; status: number };
    expect(json.code).toBe("invalid_query");
    expect(spy.searchCalls).toEqual([]);
  });
});

describe("GET /users/resolve — mount + dispatch", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("absent ids param → empty items, repo NOT called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/resolve", {
      headers: { "x-test-user": "t3" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(spy.resolveCalls).toEqual([]);
  });

  test("empty ids param → empty items, repo NOT called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/resolve?ids=", {
      headers: { "x-test-user": "t4" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(spy.resolveCalls).toEqual([]);
  });

  test("all-blank ids param → empty items, repo NOT called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/resolve?ids=" + encodeURIComponent(" , ,  "), {
      headers: { "x-test-user": "t5" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(json.data.items).toEqual([]);
    expect(spy.resolveCalls).toEqual([]);
  });

  test("csv trim + filter-empty — ' a , ,b ' → ['a','b'] + happy resolve", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/resolve?ids=" + encodeURIComponent(" a , ,b "), {
      headers: { "x-test-user": "t6" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: DirectoryRow[] } };
    expect(spy.resolveCalls).toEqual([["a", "b"]]);
    expect(json.data.items).toEqual([
      { userId: "a", email: "a@x.test", displayName: "a" },
      { userId: "b", email: "b@x.test", displayName: "b" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Enumeration hardening tests (#816)
// ---------------------------------------------------------------------------

describe("GET /users/search — q validation (#816)", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("empty q → 400 and searchByEmailPrefix is NOT called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/search?q=", {
      headers: { "x-test-user": "alice" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; status: number };
    expect(body.code).toBe("invalid_query");
    expect(body.status).toBe(400);
    expect(spy.searchCalls.length).toBe(0);
  });

  test("1-char q → 400 and searchByEmailPrefix is NOT called", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/search?q=a", {
      headers: { "x-test-user": "bob" },
    });
    expect(res.status).toBe(400);
    expect(spy.searchCalls.length).toBe(0);
  });

  test("2-char q → 200, spy called once with the prefix, email present", async () => {
    const { repo, spy } = makeFakeRepo();
    const app = makeApp(repo);
    const res = await app.request("/users/search?q=al", {
      headers: { "x-test-user": "carol" },
    });
    expect(res.status).toBe(200);
    expect(spy.searchCalls.length).toBe(1);
    expect(spy.searchCalls[0]?.prefix).toBe("al");
    const body = (await res.json()) as {
      data: { items: Array<{ email: string; userId: string }> };
    };
    // Positive typeahead control: email stays in the response shape.
    expect(body.data.items[0]?.email).toBe("u1@x.test");
    // RFC 9239 limit header is present (exact value depends on env,
    // just verify it's a positive integer).
    const limitHeader = res.headers.get("RateLimit-Limit");
    expect(limitHeader).not.toBeNull();
    expect(Number(limitHeader)).toBeGreaterThan(0);
  });
});

describe("GET /users/search — rate limit (#816)", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("burst past cap → last is 429 with Retry-After + Remaining 0", async () => {
    const { repo } = makeFakeRepo();
    const app = makeApp(repo);
    const headers = { "x-test-user": "dave" };

    // Discover the actual cap from the first response.
    const probe = await app.request("/users/search?q=al", { headers });
    expect(probe.status).toBe(200);
    const cap = Number(probe.headers.get("RateLimit-Limit"));
    expect(cap).toBeGreaterThan(0);

    // Send (cap - 1) more requests to fill the bucket (first already used 1).
    for (let i = 1; i < cap; i++) {
      const ok = await app.request("/users/search?q=al", { headers });
      expect(ok.status).toBe(200);
    }
    // The next one is over the cap.
    const denied = await app.request("/users/search?q=al", { headers });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Content-Type")).toContain("application/problem+json");
    expect(denied.headers.get("Retry-After")).not.toBeNull();
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
    const body = (await denied.json()) as { code: string; status: number };
    expect(body.code).toBe("rate_limited");
    expect(body.status).toBe(429);
  });

  test("different users have independent budgets", async () => {
    const { repo } = makeFakeRepo();
    const app = makeApp(repo);
    // Discover the actual cap.
    const probe = await app.request("/users/search?q=al", { headers: { "x-test-user": "probe" } });
    const cap = Number(probe.headers.get("RateLimit-Limit"));

    // Exhaust user A.
    for (let i = 0; i < cap; i++) {
      await app.request("/users/search?q=al", { headers: { "x-test-user": "eve" } });
    }
    const aDenied = await app.request("/users/search?q=al", {
      headers: { "x-test-user": "eve" },
    });
    expect(aDenied.status).toBe(429);
    // User B is untouched.
    const bOk = await app.request("/users/search?q=al", {
      headers: { "x-test-user": "frank" },
    });
    expect(bOk.status).toBe(200);
  });
});

describe("GET /users/resolve — shared rate-limit budget (#816)", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("burst on /users/resolve → 429 after cap+1 for one user", async () => {
    const { repo } = makeFakeRepo();
    const app = makeApp(repo);
    // Discover cap from a search probe.
    const probe = await app.request("/users/search?q=al", { headers: { "x-test-user": "probe" } });
    const cap = Number(probe.headers.get("RateLimit-Limit"));

    const headers = { "x-test-user": "grace" };
    for (let i = 0; i < cap; i++) {
      const ok = await app.request("/users/resolve?ids=u1,u2", { headers });
      expect(ok.status).toBe(200);
    }
    const denied = await app.request("/users/resolve?ids=u1,u2", { headers });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).not.toBeNull();
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
  });

  test("search + resolve draw from ONE shared per-user budget (same label)", async () => {
    const { repo } = makeFakeRepo();
    const app = makeApp(repo);
    // Discover cap.
    const probe = await app.request("/users/search?q=al", { headers: { "x-test-user": "probe" } });
    const cap = Number(probe.headers.get("RateLimit-Limit"));

    const headers = { "x-test-user": "heidi" };
    // Spend the budget across both endpoints: a search + resolves.
    const first = await app.request("/users/search?q=al", { headers });
    expect(first.status).toBe(200);
    for (let i = 1; i < cap; i++) {
      const ok = await app.request("/users/resolve?ids=u1", { headers });
      expect(ok.status).toBe(200);
    }
    // cap requests spent across the two routes → the (cap+1)th on
    // EITHER route is denied because they share the bucket.
    const denied = await app.request("/users/resolve?ids=u9", { headers });
    expect(denied.status).toBe(429);
  });
});
