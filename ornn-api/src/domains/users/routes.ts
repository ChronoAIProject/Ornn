/**
 * User-directory endpoints — read-only lookups against the `users`
 * collection (lazily populated on every authenticated request, see
 * `domains/users/repository`). Backs the skill-permissions panel's
 * collaborator typeahead.
 *
 * Replaced the old activities-derived directory in issue #271.
 *
 * @module domains/users/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
} from "../../middleware/nyxidAuth";
import { validateQuery, getValidatedQuery } from "../../middleware/validate";
import { rateLimit } from "../../middleware/rateLimit";
import { createLogger } from "../../shared/logger";
import type { UserDirectoryRepository } from "./repository";

const logger = createLogger("userRoutes");

/**
 * Minimum `q` length for the user-directory typeahead (#816). Empty /
 * 1-char queries are rejected with 400 so an authenticated caller can't
 * walk the entire directory one prefix at a time (enumeration). Clamped
 * to a floor of 2 — operators can raise it via env but never below 2.
 */
const MIN_Q = Math.max(2, Number(process.env.ORNN_USER_SEARCH_MIN_Q) || 2);

/**
 * Per-user (per-IP for the rare anon path) burst budget shared across the
 * whole directory surface (#816). Both /users/search and /users/resolve
 * mount the SAME limiter label, so the budget is a single shared
 * allowance — an enumerator can't sidestep the search cap by pivoting to
 * resolve. Defaults: 30 req / 60s. Env-tunable.
 */
const RL_WINDOW_MS = Number(process.env.ORNN_USER_DIRECTORY_RATELIMIT_WINDOW_MS) || 60_000;
const RL_MAX = Number(process.env.ORNN_USER_DIRECTORY_RATELIMIT_PER_MIN) || 30;

const searchQuerySchema = z.object({
  // #816 — require a real prefix. Empty / 1-char `q` now 400s via the
  // validateQuery seam (dropped `.optional().default("")`). The repo's
  // empty-q branch stays intact because admin/quota/routes.ts depends on
  // it; the enumeration gate lives HERE in the route, not the repo.
  q: z.string().trim().min(MIN_Q).max(256),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export interface UserRoutesConfig {
  userDirectoryRepo: UserDirectoryRepository;
}

export function createUserRoutes(
  config: UserRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { userDirectoryRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  // Shared per-user budget across the whole directory surface (#816).
  // One limiter instance, one label → /users/search and /users/resolve
  // draw from the same bucket.
  const directoryRateLimit = rateLimit({
    windowMs: RL_WINDOW_MS,
    max: RL_MAX,
    label: "users-directory",
  });

  /**
   * GET /users/search?q=<email-prefix>&limit=<N>
   *
   * Any authenticated caller can search — shared skills need sharing
   * targets, and we intentionally don't gate this behind admin. Result
   * set is scoped to users who have actually interacted with Ornn
   * (have a directory row).
   *
   * Issue #816 — option (a): reject empty/1-char q + per-user rate
   * limit. Email stays in the response because the collaborator
   * typeahead matches on email prefix; the repository empty-q branch is
   * intentionally left intact because admin/quota/routes.ts depends on
   * it — the enumeration gate lives HERE in the route, not the repo.
   *
   * Mount order: auth → directoryRateLimit → validateQuery → handler,
   * so the limiter keys on the authenticated userId (set upstream) and
   * runs before the schema check.
   */
  app.get(
    "/users/search",
    auth,
    directoryRateLimit,
    validateQuery(searchQuerySchema, "invalid_query"),
    async (c) => {
      const parsed = getValidatedQuery<z.infer<typeof searchQuerySchema>>(c);
      logger.debug(
        { qLen: parsed.q.length, limit: parsed.limit },
        "user directory search",
      );
      const results = await userDirectoryRepo.searchByEmailPrefix(
        parsed.q,
        parsed.limit,
      );
      return c.json({ data: { items: results }, error: null });
    },
  );

  /**
   * GET /users/resolve?ids=id1,id2,...
   *
   * Batch-resolve a list of user_ids to their email + displayName.
   * Used by the permissions panel to render labels for
   * `sharedWithUsers` entries that were saved as bare user_ids — an
   * email-prefix search can't match on a UUID, so we need a direct
   * id→row lookup. Unknown ids (users who never signed into Ornn)
   * are silently dropped from the response.
   *
   * Shares the `users-directory` rate-limit budget with /users/search
   * (#816) — same label, same per-user bucket — so an enumerator can't
   * dodge the search cap by pivoting to resolve.
   */
  app.get("/users/resolve", auth, directoryRateLimit, async (c) => {
    const raw = c.req.query("ids") ?? "";
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    if (ids.length === 0) {
      return c.json({ data: { items: [] }, error: null });
    }
    const items = await userDirectoryRepo.findByUserIds(ids);
    return c.json({ data: { items }, error: null });
  });

  return app;
}
