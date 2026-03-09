/**
 * Skill search routes with NyxID auth.
 * GET /api/skill-search — keyword and smart (LLM) search.
 * @module domains/skillSearch/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SearchService } from "./service";
import {
  type AuthVariables,
  type NyxIDAuthConfig,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillSearchRoutes" });

const searchQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  mode: z.enum(["keyword", "smart"]).optional().default("keyword"),
  scope: z.enum(["public", "private", "mixed"]).optional().default("private"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(9),
  model: z.string().optional(),
});

export interface SearchRoutesConfig {
  searchService: SearchService;
  authConfig: NyxIDAuthConfig;
}

export function createSearchRoutes(config: SearchRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { searchService, authConfig } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware(authConfig);

  /**
   * GET /skill-search — Unified search endpoint.
   * Auth: NyxID JWT or API Key.
   * Requires: ornn:skill:read
   * Modes: keyword (MongoDB regex), smart (LLM batch evaluation)
   */
  app.get(
    "/skill-search",
    auth,
    requirePermission("ornn:skill:read"),
    async (c) => {
      const raw = {
        query: c.req.query("query"),
        mode: c.req.query("mode"),
        scope: c.req.query("scope"),
        page: c.req.query("page"),
        pageSize: c.req.query("pageSize"),
        model: c.req.query("model"),
      };

      const parsed = searchQuerySchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_QUERY",
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        );
      }

      const { query, mode, scope, page, pageSize, model } = parsed.data;

      if (mode === "smart" && (!query || query.trim() === "")) {
        throw AppError.badRequest(
          "QUERY_REQUIRED",
          "Query parameter is required when search mode is 'smart'",
        );
      }

      const authCtx = getAuth(c);
      logger.debug({ mode, scope, query: query.slice(0, 50), userId: authCtx.userId }, "Search request");

      // Extract bearer token for LLM passthrough (smart search)
      const authHeader = c.req.header("Authorization") ?? "";
      const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

      const response = await searchService.search({
        query,
        mode,
        scope,
        page,
        pageSize,
        currentUserId: authCtx.userId,
        userToken,
        model,
      });

      return c.json({ data: response, error: null });
    },
  );

  return app;
}
