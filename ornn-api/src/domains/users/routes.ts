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
import type { UserDirectoryRepository } from "./repository";

const searchQuerySchema = z.object({
  q: z.string().max(256).optional().default(""),
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

  /**
   * GET /users/search?q=<email-prefix>&limit=<N>
   *
   * Any authenticated caller can search — shared skills need sharing
   * targets, and we intentionally don't gate this behind admin. Result
   * set is scoped to users who have actually interacted with Ornn
   * (have a directory row).
   */
  app.get(
    "/users/search",
    auth,
    validateQuery(searchQuerySchema, "INVALID_QUERY"),
    async (c) => {
      const parsed = getValidatedQuery<z.infer<typeof searchQuerySchema>>(c);
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
   */
  app.get("/users/resolve", auth, async (c) => {
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
