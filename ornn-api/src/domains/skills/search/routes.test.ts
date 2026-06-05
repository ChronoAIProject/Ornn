/**
 * Tests for the skill-search route's pagination bounds (CWE-770, #810).
 *
 * The `?page=` query param feeds an offset-based `.skip()` underneath.
 * Without an upper bound a caller could request `?page=999999999` and
 * drive a multi-second collection scan. `searchQuerySchema.page` now
 * carries `.max(MAX_PAGE)`, so the request is rejected at the
 * `validateQuery` layer with a 400 `invalid_query` BEFORE the handler
 * (and the service) ever runs.
 *
 * The stub services here are intentionally inert: the 400 case never
 * reaches them, and the positive-control 200 case only exercises
 * `searchService.search` (which returns an empty result set).
 *
 * @module domains/skills/search/routes.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSearchRoutes, type SearchRoutesConfig } from "./routes";
import type { SearchService } from "./service";
import type { SkillRepository } from "../crud/repository";
import type { NyxidServiceClient } from "../../../clients/nyxid/service";
import {
  AppError,
  buildProblemJsonBody,
  type SkillSearchResponse,
} from "../../../shared/types/index";
import { encodeCursor } from "../../../shared/cursor";
import { __resetRateLimitForTests } from "../../../middleware/rateLimit";

/**
 * Optional auth seam for the route tests. Production wires the auth
 * context via `proxyAuthSetup`; here a one-liner middleware sets
 * `c.get("auth")` to a fixed identity so the authed branches
 * (semantic, mine/shared scope, /skill-counts authed) execute. Omit it
 * for the anonymous-caller branches.
 */
interface AuthOpts {
  userId?: string;
  permissions?: string[];
}

/**
 * Mount the real search routes with stub deps under a Hono app whose
 * onError mirrors the global handler (AppError → problem+json).
 *
 * Backward-compatible with the original two-arg-less call: passing only
 * a `searchImpl` reproduces the page-bound positive/negative controls
 * (anonymous, inert skillRepo, no NyxID client). The extra optional
 * config lets the #876 coverage cases inject auth, a fuller skillRepo
 * (facets + counts surface), and the NyxID active-service client.
 */
function makeApp(
  searchImpl?: SearchService["search"],
  extra: {
    auth?: AuthOpts;
    skillRepo?: Partial<SkillRepository>;
    nyxidServiceClient?: NyxidServiceClient;
    getSaAccessToken?: () => Promise<string>;
  } = {},
) {
  const searchService = {
    search:
      searchImpl ??
      (async (): Promise<SkillSearchResponse> => {
        throw new Error("search() should not be called when validation rejects");
      }),
  } as unknown as SearchService;

  // skillRepo is never touched on the /skill-search path — the route
  // only calls searchService.search. Facet/count cases inject the
  // aggregate surface they need via `extra.skillRepo`.
  const skillRepo = (extra.skillRepo ?? {}) as unknown as SkillRepository;

  const config: SearchRoutesConfig = {
    searchService,
    skillRepo,
    ...(extra.nyxidServiceClient ? { nyxidServiceClient: extra.nyxidServiceClient } : {}),
    ...(extra.getSaAccessToken ? { getSaAccessToken: extra.getSaAccessToken } : {}),
  };

  const app = new Hono();
  if (extra.auth) {
    const { userId = "user-1", permissions = [] } = extra.auth;
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
  app.route("/", createSearchRoutes(config));
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

/** Empty-result factory for `searchService.search` positive-control runs. */
function emptyResult(
  overrides: Partial<SkillSearchResponse> = {},
): SkillSearchResponse {
  return {
    searchMode: "keyword",
    searchScope: "public",
    total: 0,
    totalPages: 0,
    page: 1,
    pageSize: 9,
    items: [],
    ...overrides,
  };
}

describe("GET /skill-search — page bound (CWE-770, #810)", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("rejects ?page=999999999 with 400 invalid_query", async () => {
    const app = makeApp();
    const res = await app.request("/skill-search?page=999999999");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_query");
  });

  test("accepts ?page=10000 (the ceiling) — does not 400 at validation", async () => {
    const app = makeApp(async () => emptyResult({ page: 10_000 }));
    const res = await app.request("/skill-search?page=10000");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as { data: { items: unknown[] }; error: unknown };
    expect(body.error).toBeNull();
    expect(body.data.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Semantic-mode guards (#876)
// ---------------------------------------------------------------------

describe("GET /skill-search — semantic guards", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("semantic without a query → 400 QUERY_REQUIRED (authed)", async () => {
    const app = makeApp(async () => emptyResult(), { auth: {} });
    const res = await app.request("/skill-search?mode=semantic&scope=public");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("QUERY_REQUIRED");
  });

  test("anonymous semantic search → 400 AUTH_REQUIRED", async () => {
    const app = makeApp(async () => emptyResult());
    const res = await app.request("/skill-search?mode=semantic&q=ranking");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  test("authed semantic with a query reaches the service", async () => {
    let seen = false;
    const app = makeApp(
      async () => {
        seen = true;
        return emptyResult({ searchMode: "semantic" });
      },
      { auth: {} },
    );
    const res = await app.request("/skill-search?mode=semantic&q=ranking&scope=mixed");
    expect(res.status).toBe(200);
    expect(seen).toBe(true);
  });
});

// ---------------------------------------------------------------------
// Cursor pagination + scope collapse + query precedence + CSV (#876)
// ---------------------------------------------------------------------

describe("GET /skill-search — cursor / scope / params", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("a valid cursor decodes and overrides page", async () => {
    let seenPage = -1;
    const app = makeApp(
      async (params) => {
        seenPage = params.page;
        return emptyResult({ page: params.page });
      },
      { auth: {} },
    );
    const cursor = encodeCursor({ page: 4 });
    const res = await app.request(`/skill-search?q=x&cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(seenPage).toBe(4);
  });

  test("a malformed cursor → 400 invalid_cursor", async () => {
    const app = makeApp(async () => emptyResult(), { auth: {} });
    const res = await app.request("/skill-search?q=x&cursor=not-a-real-cursor");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_cursor");
  });

  test("anonymous caller collapses shared-with-me scope to public", async () => {
    let seenScope = "";
    const app = makeApp(async (params) => {
      seenScope = params.scope;
      return emptyResult();
    });
    const res = await app.request("/skill-search?scope=shared-with-me");
    expect(res.status).toBe(200);
    expect(seenScope).toBe("public");
  });

  test("anonymous caller collapses mine scope to public", async () => {
    let seenScope = "";
    const app = makeApp(async (params) => {
      seenScope = params.scope;
      return emptyResult();
    });
    const res = await app.request("/skill-search?scope=mine");
    expect(res.status).toBe(200);
    expect(seenScope).toBe("public");
  });

  test("q wins over the legacy query param", async () => {
    let seenQuery = "";
    const app = makeApp(
      async (params) => {
        seenQuery = params.query;
        return emptyResult();
      },
      { auth: {} },
    );
    const res = await app.request("/skill-search?q=canonical&query=legacy");
    expect(res.status).toBe(200);
    expect(seenQuery).toBe("canonical");
  });

  test("legacy query is used when q is absent", async () => {
    let seenQuery = "";
    const app = makeApp(
      async (params) => {
        seenQuery = params.query;
        return emptyResult();
      },
      { auth: {} },
    );
    const res = await app.request("/skill-search?query=legacy-only");
    expect(res.status).toBe(200);
    expect(seenQuery).toBe("legacy-only");
  });

  test("CSV filters (tags / sharedWith* / createdByAny) are parsed into arrays", async () => {
    let captured: Parameters<SearchService["search"]>[0] | null = null;
    const app = makeApp(
      async (params) => {
        captured = params;
        return emptyResult();
      },
      { auth: {} },
    );
    const res = await app.request(
      "/skill-search?q=x&tags=a,b,%20c%20&sharedWithOrgs=o1,o2&sharedWithUsers=u1&createdByAny=x1,,x2",
    );
    expect(res.status).toBe(200);
    expect(captured).not.toBeNull();
    const p = captured as unknown as Parameters<SearchService["search"]>[0];
    expect(p.tagsAll).toEqual(["a", "b", "c"]);
    expect(p.sharedWithOrgsAny).toEqual(["o1", "o2"]);
    expect(p.sharedWithUsersAny).toEqual(["u1"]);
    expect(p.createdByAny).toEqual(["x1", "x2"]);
  });

  test("meta envelope carries limit/hasMore/nextCursor for a full page", async () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      guid: `g${i}`,
      name: `s${i}`,
      description: "",
      createdBy: "a",
      createdOn: "2026-01-01T00:00:00.000Z",
      updatedOn: "2026-01-01T00:00:00.000Z",
      isPrivate: false,
      tags: [],
    }));
    const app = makeApp(
      async () => emptyResult({ total: 50, totalPages: 6, page: 1, pageSize: 9, items }),
      { auth: {} },
    );
    const res = await app.request("/skill-search?q=x&pageSize=9");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { meta: { limit: number; hasMore: boolean; nextCursor?: string } };
    };
    expect(body.data.meta.limit).toBe(9);
    expect(body.data.meta.hasMore).toBe(true);
    expect(typeof body.data.meta.nextCursor).toBe("string");
  });

  test("meta.hasMore is false and nextCursor omitted on a short last page", async () => {
    const app = makeApp(
      async () => emptyResult({ total: 2, totalPages: 1, page: 1, pageSize: 9, items: [] }),
      { auth: {} },
    );
    const res = await app.request("/skill-search?q=x");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { meta: { hasMore: boolean; nextCursor?: string } };
    };
    expect(body.data.meta.hasMore).toBe(false);
    expect(body.data.meta.nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------
// Facet endpoints (#876)
// ---------------------------------------------------------------------

describe("GET /skill-facets/tags", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("rejects an unknown scope with 400 invalid_scope", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateTagsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/tags?scope=bogus");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_scope");
  });

  test("anonymous caller on a 'mine' scope → 401 AUTH_REQUIRED", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateTagsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/tags?scope=mine");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AUTH_REQUIRED");
  });

  test("anonymous caller on a 'shared-with-me' scope → 401", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateTagsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/tags?scope=shared-with-me");
    expect(res.status).toBe(401);
  });

  test("authed 'mine' scope returns the aggregated tags", async () => {
    const app = makeApp(undefined, {
      auth: {},
      skillRepo: {
        aggregateTagsByScope: async () => [{ name: "csv", count: 3 }],
      },
    });
    const res = await app.request("/skill-facets/tags?scope=mine");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ name: string }> } };
    expect(body.data.items[0]?.name).toBe("csv");
  });

  test("anonymous 'public' scope is allowed (default scope)", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateTagsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/tags");
    expect(res.status).toBe(200);
  });
});

describe("GET /skill-facets/authors", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("rejects an unsupported scope with 400 invalid_scope", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateAuthorsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/authors?scope=mine");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_scope");
  });

  test("anonymous 'shared-with-me' scope → 401", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateAuthorsByScope: async () => [] },
    });
    const res = await app.request("/skill-facets/authors?scope=shared-with-me");
    expect(res.status).toBe(401);
  });

  test("authed 'shared-with-me' scope returns aggregated authors", async () => {
    const app = makeApp(undefined, {
      auth: {},
      skillRepo: {
        aggregateAuthorsByScope: async () => [
          { userId: "a1", email: "a@x", displayName: "A", count: 2 },
        ],
      },
    });
    const res = await app.request("/skill-facets/authors?scope=shared-with-me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ userId: string }> } };
    expect(body.data.items[0]?.userId).toBe("a1");
  });
});

describe("GET /skill-facets/system-services", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  const aggregated = [
    { id: "svc-1", slug: "billing", label: "Billing", count: 2 },
    { id: "svc-2", slug: "ledger", label: "Ledger", count: 1 },
  ];

  test("returns the raw DB aggregation when no NyxID client is wired", async () => {
    const app = makeApp(undefined, {
      skillRepo: { aggregateSystemServices: async () => aggregated },
    });
    const res = await app.request("/skill-facets/system-services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    expect(body.data.items.map((i) => i.id)).toEqual(["svc-1", "svc-2"]);
  });

  test("filters to NyxID's active set when client + SA token are wired", async () => {
    const nyxidServiceClient = {
      listActiveServiceIdsAsPlatform: async () => new Set(["svc-1"]),
    } as unknown as NyxidServiceClient;
    const app = makeApp(undefined, {
      skillRepo: { aggregateSystemServices: async () => aggregated },
      nyxidServiceClient,
      getSaAccessToken: async () => "sa-token",
    });
    const res = await app.request("/skill-facets/system-services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    expect(body.data.items.map((i) => i.id)).toEqual(["svc-1"]);
  });

  test("falls back to the unfiltered facet when the NyxID client throws", async () => {
    const nyxidServiceClient = {
      listActiveServiceIdsAsPlatform: async () => {
        throw new Error("NyxID unreachable");
      },
    } as unknown as NyxidServiceClient;
    const app = makeApp(undefined, {
      skillRepo: { aggregateSystemServices: async () => aggregated },
      nyxidServiceClient,
      getSaAccessToken: async () => "sa-token",
    });
    const res = await app.request("/skill-facets/system-services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    expect(body.data.items.map((i) => i.id)).toEqual(["svc-1", "svc-2"]);
  });

  test("returns the unfiltered facet when NyxID reports a null active set", async () => {
    const nyxidServiceClient = {
      listActiveServiceIdsAsPlatform: async () => null,
    } as unknown as NyxidServiceClient;
    const app = makeApp(undefined, {
      skillRepo: { aggregateSystemServices: async () => aggregated },
      nyxidServiceClient,
      getSaAccessToken: async () => "sa-token",
    });
    const res = await app.request("/skill-facets/system-services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { items: Array<{ id: string }> } };
    expect(body.data.items.length).toBe(2);
  });
});

// ---------------------------------------------------------------------
// Tab counts (#876)
// ---------------------------------------------------------------------

describe("GET /skill-counts", () => {
  beforeEach(() => __resetRateLimitForTests());
  afterEach(() => __resetRateLimitForTests());

  test("authed caller gets all three scoped counts", async () => {
    const byScope: Record<string, number> = {
      public: 10,
      mine: 4,
      "shared-with-me": 2,
    };
    const app = makeApp(undefined, {
      auth: {},
      skillRepo: {
        countByScope: async (scope: string) => byScope[scope] ?? 0,
      } as Partial<SkillRepository>,
    });
    const res = await app.request("/skill-counts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { public: number; mine: number; sharedWithMe: number };
    };
    expect(body.data).toEqual({ public: 10, mine: 4, sharedWithMe: 2 });
  });

  test("anonymous caller gets only the public count; mine + shared are 0", async () => {
    let publicQueried = false;
    const app = makeApp(undefined, {
      skillRepo: {
        countByScope: async (scope: string) => {
          if (scope === "public") {
            publicQueried = true;
            return 7;
          }
          throw new Error(`countByScope should not run for scope '${scope}' when anonymous`);
        },
      } as Partial<SkillRepository>,
    });
    const res = await app.request("/skill-counts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { public: number; mine: number; sharedWithMe: number };
    };
    expect(publicQueried).toBe(true);
    expect(body.data).toEqual({ public: 7, mine: 0, sharedWithMe: 0 });
  });
});
