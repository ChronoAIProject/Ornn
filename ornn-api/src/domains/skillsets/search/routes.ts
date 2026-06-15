/**
 * Skillset search routes (#969).
 *
 * `GET /skillset-search` — plain-Mongo discovery by `kind` / `tags` /
 * `scope`, with cursor pagination per CONVENTIONS.md §4.3. Sibling of
 * `/skill-search` (not a `/skillsets/*` sub-resource) so it never collides
 * with `GET /skillsets/:idOrName`.
 *
 * @module domains/skillsets/search/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  optionalAuthMiddleware,
  readUserOrgIds,
} from "../../../middleware/nyxidAuth";
import { validateQuery, getValidatedQuery } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";
import { decodeCursor, buildNextCursor, MAX_PAGE } from "../../../shared/cursor";
import { rateLimit } from "../../../middleware/rateLimit";
import { SKILLSET_KINDS } from "../types";
import type { SkillsetSearchService } from "./service";

const logger = createLogger("skillsetSearchRoutes");

const searchQuerySchema = z.object({
  kind: z.enum(SKILLSET_KINDS).optional(),
  scope: z
    .enum(["public", "private", "mixed", "shared-with-me", "mine"])
    .optional()
    .default("public"),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** Comma-separated tag list — skillsets must have ALL listed tags. */
  tags: z.string().optional(),
  /** Free-text keyword — case-insensitive substring on name + description. */
  q: z.string().max(200).optional(),
});

function parseCsv(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
}

export interface SkillsetSearchRoutesConfig {
  skillsetSearchService: SkillsetSearchService;
}

export function createSkillsetSearchRoutes(
  config: SkillsetSearchRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { skillsetSearchService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * GET /skillset-search — discover skillsets by kind / tags / scope.
   * Auth: optional. Anonymous callers see public skillsets only.
   */
  app.get(
    "/skillset-search",
    optionalAuth,
    rateLimit({ windowMs: 60_000, max: 60, label: "skillset-search" }),
    validateQuery(searchQuerySchema, "invalid_query"),
    async (c) => {
      const parsed = getValidatedQuery<z.infer<typeof searchQuerySchema>>(c);
      const pageSize = parsed.limit ?? parsed.pageSize;
      let page = parsed.page;
      if (parsed.cursor !== undefined) {
        const decoded = decodeCursor(parsed.cursor);
        if (!decoded) {
          throw AppError.badRequest(
            "invalid_cursor",
            "The provided cursor is malformed or from a previous API version.",
          );
        }
        page = decoded.page;
      }

      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;
      // Anonymous callers can only search public scope.
      const scope = isAnonymous ? "public" : parsed.scope;
      const currentUserId = authCtx?.userId ?? "";
      const userOrgIds = authCtx ? await readUserOrgIds(c) : [];

      logger.debug(
        { kind: parsed.kind ?? null, scope, anonymous: isAnonymous },
        "Skillset search request",
      );

      const response = await skillsetSearchService.search({
        scope,
        currentUserId,
        userOrgIds,
        page,
        pageSize,
        kind: parsed.kind,
        tagsAll: parseCsv(parsed.tags),
        q: parsed.q,
      });

      const itemsReturned = response.items.length;
      const meta = {
        limit: pageSize,
        hasMore: itemsReturned >= pageSize && response.page * pageSize < response.total,
        nextCursor: buildNextCursor({
          currentPage: response.page,
          pageSize,
          itemsReturned,
        }),
      };
      return c.json({ data: { ...response, meta }, error: null });
    },
  );

  return app;
}
