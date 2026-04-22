/**
 * User-directory endpoints. Backed by Ornn's `activities` collection — we
 * don't maintain a dedicated `users` table. Every authenticated request
 * Ornn sees gets logged to `activities`, which gives us a living directory
 * of everyone who's ever used Ornn keyed by user_id + email + display_name.
 *
 * This is specifically a read-only lookup for the permissions panel
 * typeahead. No admin-level data is returned; just enough to resolve an
 * email to a user_id.
 *
 * @module domains/users/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { ActivityRepository } from "../admin/activityRepository";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
} from "../../middleware/nyxidAuth";
import { validateQuery, getValidatedQuery } from "../../middleware/validate";

const searchQuerySchema = z.object({
  q: z.string().max(256).optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export interface UserRoutesConfig {
  activityRepo: ActivityRepository;
}

export function createUserRoutes(config: UserRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { activityRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  /**
   * GET /users/search?q=<email-prefix>&limit=<N>
   *
   * Any authenticated caller can search — shared skills need sharing
   * targets, and we intentionally don't gate this behind admin. Result
   * set is scoped to users who have actually interacted with Ornn
   * (have an activity row).
   */
  app.get(
    "/users/search",
    auth,
    validateQuery(searchQuerySchema, "INVALID_QUERY"),
    async (c) => {
      const parsed = getValidatedQuery<z.infer<typeof searchQuerySchema>>(c);
      const results = await activityRepo.searchUsersByEmail(parsed.q, parsed.limit);
      return c.json({ data: { items: results }, error: null });
    },
  );

  /**
   * GET /users/resolve?ids=id1,id2,...
   *
   * Batch-resolve a list of user_ids to their email + displayName using
   * Ornn's activity directory. Used by the permissions panel to render
   * human labels for `sharedWithUsers` entries that were saved as bare
   * user_ids — an email-prefix search can't match on a UUID, so we
   * need a direct id→row lookup.
   *
   * Unknown ids (users who never signed into Ornn) are silently dropped
   * from the response. The UI should fall back to the raw id in that case.
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
    const items = await activityRepo.findByUserIds(ids);
    return c.json({ data: { items }, error: null });
  });

  return app;
}
