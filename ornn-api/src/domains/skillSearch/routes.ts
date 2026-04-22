/**
 * Skill search routes with NyxID auth.
 * GET /api/skill-search — keyword and semantic (LLM) search.
 * @module domains/skillSearch/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SearchService } from "./service";
import type { SkillRepository } from "../skillCrud/repository";
import { NyxidUserServicesClient, type UserService } from "../../clients/nyxidUserServicesClient";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  getAuth,
  optionalAuthMiddleware,
  readUserOrgIds,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillSearchRoutes" });

const searchQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  mode: z.enum(["keyword", "semantic"]).optional().default("keyword"),
  scope: z.enum(["public", "private", "mixed", "shared-with-me", "mine"]).optional().default("private"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9),
  model: z.string().optional(),
  /** System-skill tri-state filter. `any` (default) keeps all; `only`
   *  restricts to skills whose tags match any of the caller's NyxID
   *  service slugs; `exclude` drops those. */
  systemFilter: z.enum(["any", "only", "exclude"]).optional().default("any"),
  /** Comma-separated filters for the registry filter chips. */
  sharedWithOrgs: z.string().optional(),
  sharedWithUsers: z.string().optional(),
  createdByAny: z.string().optional(),
});

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export interface SearchRoutesConfig {
  searchService: SearchService;
  /** Caller's NyxID services used for system-skill enrichment + filter. */
  nyxidBaseUrl: string;
  skillRepo: SkillRepository;
}

export function createSearchRoutes(config: SearchRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { searchService, skillRepo } = config;
  const userServicesClient = new NyxidUserServicesClient(config.nyxidBaseUrl);
  const app = new Hono<{ Variables: AuthVariables }>();

  const optionalAuth = optionalAuthMiddleware();
  const requireAuth = nyxidAuthMiddleware();

  /** Fetch caller's NyxID services, fail-soft to empty list. */
  async function loadCallerServices(token: string | undefined): Promise<UserService[]> {
    if (!token) return [];
    try {
      return await userServicesClient.listUserServices(token);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Caller NyxID service lookup failed; system-skill detection disabled");
      return [];
    }
  }

  /**
   * GET /skill-search — Unified search endpoint.
   * Auth: Optional. Anonymous users can only search public skills.
   * Authenticated users can search public, private, or mixed scope.
   * Modes: keyword (MongoDB regex), semantic (LLM-based relevance ranking)
   */
  app.get(
    "/skill-search",
    optionalAuth,
    async (c) => {
      const raw = {
        query: c.req.query("query"),
        mode: c.req.query("mode"),
        scope: c.req.query("scope"),
        page: c.req.query("page"),
        pageSize: c.req.query("pageSize"),
        model: c.req.query("model"),
        systemFilter: c.req.query("systemFilter"),
        sharedWithOrgs: c.req.query("sharedWithOrgs"),
        sharedWithUsers: c.req.query("sharedWithUsers"),
        createdByAny: c.req.query("createdByAny"),
      };

      const parsed = searchQuerySchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_QUERY",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        );
      }

      const { query, mode, page, pageSize, model, systemFilter } = parsed.data;
      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;

      // Anonymous users can only search public scope.
      // `shared-with-me` implies an identified caller — collapse to public for anonymous.
      const requestedScope = parsed.data.scope;
      const scope = isAnonymous
        ? "public"
        : requestedScope;
      const currentUserId = authCtx?.userId ?? "";

      if (mode === "semantic") {
        if (!query || query.trim() === "") {
          throw AppError.badRequest(
            "QUERY_REQUIRED",
            "Query parameter is required when search mode is 'semantic'",
          );
        }
        if (isAnonymous) {
          throw AppError.badRequest(
            "AUTH_REQUIRED",
            "Semantic search requires authentication",
          );
        }
      }

      logger.debug({ mode, scope, query: query.slice(0, 50), userId: currentUserId, anonymous: isAnonymous }, "Search request");

      const userOrgIds = await readUserOrgIds(c);

      // Only fetch caller services when we actually need them — either
      // for enrichment (any authenticated caller) or for the system
      // filter.
      const callerServices = authCtx
        ? await loadCallerServices(authCtx.userAccessToken)
        : [];

      const response = await searchService.search({
        query,
        mode,
        scope,
        page,
        pageSize,
        currentUserId,
        userOrgIds,
        model,
        callerServices,
        systemFilter,
        sharedWithOrgsAny: parseCsv(parsed.data.sharedWithOrgs),
        sharedWithUsersAny: parseCsv(parsed.data.sharedWithUsers),
        createdByAny: parseCsv(parsed.data.createdByAny),
      });

      return c.json({ data: response, error: null });
    },
  );

  /**
   * GET /skill-counts — registry tab counts in a single round-trip.
   * Returns `{ public, mine, sharedWithMe }` for the current caller.
   * Anonymous callers get a public count only; `mine` and
   * `sharedWithMe` are 0 (no identity → no "mine").
   *
   * Path choice: kept out of `/skills/*` so it doesn't collide with
   * `GET /skills/:id` (which is registered from skillCrud and would
   * otherwise capture `id="counts"`).
   */
  app.get("/skill-counts", optionalAuth, async (c) => {
    const authCtx = c.get("auth");
    const currentUserId = authCtx?.userId ?? "";
    const userOrgIds = authCtx ? await readUserOrgIds(c) : [];

    const [publicCount, mineCount, sharedCount] = await Promise.all([
      skillRepo.countByScope("public", currentUserId, userOrgIds),
      authCtx ? skillRepo.countByScope("mine", currentUserId, userOrgIds) : Promise.resolve(0),
      authCtx ? skillRepo.countByScope("shared-with-me", currentUserId, userOrgIds) : Promise.resolve(0),
    ]);

    return c.json({
      data: { public: publicCount, mine: mineCount, sharedWithMe: sharedCount },
      error: null,
    });
  });

  // Silence unused-symbol warning — requireAuth reserved for future
  // endpoints (grants-summary, sources-summary) that gate on auth.
  void requireAuth;
  void getAuth;

  return app;
}
