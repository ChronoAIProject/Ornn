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
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillSearchRoutes" });

const searchQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  mode: z.enum(["keyword", "semantic"]).optional().default("keyword"),
  scope: z.enum(["public", "private", "mixed", "shared-with-me"]).optional().default("private"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9),
  model: z.string().optional(),
  /** Optional topic id-or-name; restricts results to skills in that topic. */
  topic: z.string().max(128).optional(),
  /** System-skill tri-state filter. `any` (default) keeps all; `only`
   *  restricts to skills whose tags match any of the caller's NyxID
   *  service slugs; `exclude` drops those. */
  systemFilter: z.enum(["any", "only", "exclude"]).optional().default("any"),
});

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
        topic: c.req.query("topic"),
      };

      const parsed = searchQuerySchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_QUERY",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        );
      }

      const { query, mode, page, pageSize, model, topic, systemFilter } = parsed.data;
      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;

      // Anonymous users can only search public scope.
      // `shared-with-me` implies an identified caller — collapse to public for anonymous.
      const requestedScope = parsed.data.scope;
      const scope = isAnonymous
        ? "public"
        : requestedScope;
      const currentUserId = authCtx?.userId ?? "";
      const isAdmin = authCtx?.permissions.includes("ornn:admin:skill") ?? false;

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
      // The topic-visibility gate needs full memberships (userId + role) to
      // decide whether the caller can see a private org-owned topic, not
      // just the flat list of org user_ids. Anonymous callers end up with
      // an empty array and can't reach private topics anyway.
      const memberships = authCtx ? await readUserOrgMemberships(c) : [];

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
        memberships,
        model,
        topic,
        isAdmin,
        callerServices,
        systemFilter,
      });

      return c.json({ data: response, error: null });
    },
  );

  /**
   * GET /skills/counts — registry tab counts in a single round-trip.
   * Returns `{ public, mine, sharedWithMe }` for the current caller.
   * Anonymous callers get a public count only; `mine` and
   * `sharedWithMe` are 0 (no identity → no "mine").
   */
  app.get("/skills/counts", optionalAuth, async (c) => {
    const authCtx = c.get("auth");
    const currentUserId = authCtx?.userId ?? "";
    const userOrgIds = authCtx ? await readUserOrgIds(c) : [];

    const publicCountP = skillRepo.countByScope("public", currentUserId, userOrgIds);
    const mineCountP = authCtx
      ? skillRepo.countByScope("private", currentUserId, userOrgIds).then((n) => n)
      : Promise.resolve(0);
    const sharedCountP = authCtx
      ? skillRepo.countByScope("shared-with-me", currentUserId, userOrgIds)
      : Promise.resolve(0);

    // NOTE: `mine` here includes shared-with-me because `private` scope
    // covers all private skills the caller can read. For accurate "mine
    // only" we'd need a separate scope. For V1 the overlap is small and
    // UI badges are informational.
    const [publicCount, mineCount, sharedCount] = await Promise.all([publicCountP, mineCountP, sharedCountP]);

    return c.json({
      data: {
        public: publicCount,
        mine: Math.max(0, mineCount - sharedCount),
        sharedWithMe: sharedCount,
      },
      error: null,
    });
  });

  // Silence unused-symbol warning — requireAuth reserved for future
  // endpoints (grants-summary, sources-summary) that gate on auth.
  void requireAuth;
  void getAuth;

  return app;
}
