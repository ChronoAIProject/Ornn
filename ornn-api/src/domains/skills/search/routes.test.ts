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
import { createSearchRoutes } from "./routes";
import type { SearchService } from "./service";
import type { SkillRepository } from "../crud/repository";
import {
  AppError,
  buildProblemJsonBody,
  type SkillSearchResponse,
} from "../../../shared/types/index";
import { __resetRateLimitForTests } from "../../../middleware/rateLimit";

/**
 * Mount the real search routes with stub deps under a Hono app whose
 * onError mirrors the global handler (AppError → problem+json). Only
 * `searchService.search` is ever called (positive-control path); the
 * 400 path short-circuits in `validateQuery`.
 */
function makeApp(searchImpl?: SearchService["search"]) {
  const searchService = {
    search:
      searchImpl ??
      (async (): Promise<SkillSearchResponse> => {
        throw new Error("search() should not be called when validation rejects");
      }),
  } as unknown as SearchService;

  // skillRepo is never touched on the /skill-search path — the route
  // only calls searchService.search. A bare cast keeps the wiring light.
  const skillRepo = {} as unknown as SkillRepository;

  const app = new Hono();
  app.route("/", createSearchRoutes({ searchService, skillRepo }));
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
    const emptyResult: SkillSearchResponse = {
      searchMode: "keyword",
      searchScope: "public",
      total: 0,
      totalPages: 0,
      page: 10_000,
      pageSize: 9,
      items: [],
    };
    const app = makeApp(async () => emptyResult);
    const res = await app.request("/skill-search?page=10000");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as { data: { items: unknown[] }; error: unknown };
    expect(body.error).toBeNull();
    expect(body.data.items).toEqual([]);
  });
});
