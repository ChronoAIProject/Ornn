/**
 * Skill search routes with NyxID auth.
 * GET /api/skill-search — keyword and semantic (LLM) search.
 * @module domains/skillSearch/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SearchService } from "./service";
import {
  type AuthVariables,
  optionalAuthMiddleware,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillSearchRoutes" });

const searchQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  mode: z.enum(["keyword", "semantic"]).optional().default("keyword"),
  scope: z.enum(["public", "private", "mixed"]).optional().default("private"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9),
  model: z.string().optional(),
  /** Optional topic id-or-name; restricts results to skills in that topic. */
  topic: z.string().max(128).optional(),
});

export interface SearchRoutesConfig {
  searchService: SearchService;
}

export function createSearchRoutes(config: SearchRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { searchService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const optionalAuth = optionalAuthMiddleware();

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

      const { query, mode, page, pageSize, model, topic } = parsed.data;
      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;

      // Anonymous users can only search public scope
      const scope = isAnonymous ? "public" : parsed.data.scope;
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

      const response = await searchService.search({
        query,
        mode,
        scope,
        page,
        pageSize,
        currentUserId,
        model,
        topic,
        isAdmin,
      });

      return c.json({ data: response, error: null });
    },
  );

  return app;
}
