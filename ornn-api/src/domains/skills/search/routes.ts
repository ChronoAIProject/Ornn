/**
 * Skill search routes with NyxID auth.
 * GET /api/skill-search — keyword and semantic (LLM) search.
 * @module domains/skills/search/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SearchService } from "./service";
import type { SkillRepository } from "../crud/repository";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  getAuth,
  optionalAuthMiddleware,
  readUserOrgIds,
} from "../../../middleware/nyxidAuth";
import { validateQuery, getValidatedQuery } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
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
   *  restricts to skills tied to an admin/platform NyxID service
   *  (`isSystemSkill: true`); `exclude` drops those. */
  systemFilter: z.enum(["any", "only", "exclude"]).optional().default("any"),
  /** Comma-separated filters for the registry filter chips. */
  sharedWithOrgs: z.string().optional(),
  sharedWithUsers: z.string().optional(),
  createdByAny: z.string().optional(),
  /** Restrict to skills tied to this NyxID service id. Single id (not CSV). */
  nyxidServiceId: z.string().optional(),
  /** Comma-separated tag list. Skills must have ALL of the listed tags (AND match). */
  tags: z.string().optional(),
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
  skillRepo: SkillRepository;
}

export function createSearchRoutes(config: SearchRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { searchService, skillRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const optionalAuth = optionalAuthMiddleware();
  const requireAuth = nyxidAuthMiddleware();

  /**
   * GET /skill-search — Unified search endpoint.
   * Auth: Optional. Anonymous users can only search public skills.
   * Authenticated users can search public, private, or mixed scope.
   * Modes: keyword (MongoDB regex), semantic (LLM-based relevance ranking)
   */
  app.get(
    "/skill-search",
    optionalAuth,
    validateQuery(searchQuerySchema, "INVALID_QUERY"),
    async (c) => {
      const parsed = getValidatedQuery<z.infer<typeof searchQuerySchema>>(c);
      const { query, mode, page, pageSize, model, systemFilter } = parsed;
      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;

      // Anonymous users can only search public scope.
      // `shared-with-me` implies an identified caller — collapse to public for anonymous.
      const scope = isAnonymous ? "public" : parsed.scope;
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

      const response = await searchService.search({
        query,
        mode,
        scope,
        page,
        pageSize,
        currentUserId,
        userOrgIds,
        model,
        systemFilter,
        sharedWithOrgsAny: parseCsv(parsed.sharedWithOrgs),
        sharedWithUsersAny: parseCsv(parsed.sharedWithUsers),
        createdByAny: parseCsv(parsed.createdByAny),
        nyxidServiceId: parsed.nyxidServiceId || undefined,
        tagsAll: parseCsv(parsed.tags),
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
  /**
   * GET /skill-facets/tags?scope=public|mine|shared-with-me|system|mixed
   *
   * Aggregate distinct skill tags within the caller's visibility for the
   * given scope. Drives the per-tab tag filter chip row.
   *
   * Auth: required for `mine` / `shared-with-me`; optional for `public`
   *       and `system` (anonymous can see public + system facets).
   */
  app.get("/skill-facets/tags", optionalAuth, async (c) => {
    const authCtx = c.get("auth");
    const scopeRaw = (c.req.query("scope") || "public") as string;
    const allowed = ["public", "private", "mixed", "shared-with-me", "mine", "system"] as const;
    if (!(allowed as readonly string[]).includes(scopeRaw)) {
      throw AppError.badRequest("INVALID_SCOPE", `Unknown scope '${scopeRaw}'`);
    }
    const scope = scopeRaw as (typeof allowed)[number];
    if ((scope === "mine" || scope === "shared-with-me") && !authCtx) {
      throw AppError.unauthorized(
        "AUTH_REQUIRED",
        `Scope '${scope}' requires authentication`,
      );
    }
    const currentUserId = authCtx?.userId ?? "";
    const userOrgIds = authCtx ? await readUserOrgIds(c) : [];
    const items = await skillRepo.aggregateTagsByScope(scope, currentUserId, userOrgIds);
    return c.json({ data: { items }, error: null });
  });

  /**
   * GET /skill-facets/authors?scope=public|mine|shared-with-me|system
   *
   * Aggregate distinct skill authors within the caller's visibility for
   * the given scope. Returns per-author counts + display name. Powers
   * the Public-tab "filter by author" chip row. (My-Skills doesn't need
   * this — every skill there has the same author.)
   */
  app.get("/skill-facets/authors", optionalAuth, async (c) => {
    const authCtx = c.get("auth");
    const scopeRaw = (c.req.query("scope") || "public") as string;
    const allowed = ["public", "shared-with-me", "system", "mixed"] as const;
    if (!(allowed as readonly string[]).includes(scopeRaw)) {
      throw AppError.badRequest(
        "INVALID_SCOPE",
        `Unknown or unsupported scope '${scopeRaw}' for authors facet`,
      );
    }
    const scope = scopeRaw as (typeof allowed)[number];
    if (scope === "shared-with-me" && !authCtx) {
      throw AppError.unauthorized(
        "AUTH_REQUIRED",
        `Scope '${scope}' requires authentication`,
      );
    }
    const currentUserId = authCtx?.userId ?? "";
    const userOrgIds = authCtx ? await readUserOrgIds(c) : [];
    const items = await skillRepo.aggregateAuthorsByScope(scope, currentUserId, userOrgIds);
    return c.json({ data: { items }, error: null });
  });

  /**
   * GET /skill-facets/system-services
   *
   * List the NyxID services that have at least one tied system skill,
   * with per-service skill counts. Powers the System-tab service
   * filter chip row. No scope param — system skills are always public.
   */
  app.get("/skill-facets/system-services", optionalAuth, async (c) => {
    const items = await skillRepo.aggregateSystemServices();
    return c.json({ data: { items }, error: null });
  });

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
