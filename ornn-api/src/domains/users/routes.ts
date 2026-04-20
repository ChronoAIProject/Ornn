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
import { AppError } from "../../shared/types/index";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(256),
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
  app.get("/users/search", auth, async (c) => {
    const parsed = searchQuerySchema.safeParse({
      q: c.req.query("q"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      throw AppError.badRequest(
        "INVALID_QUERY",
        parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
      );
    }

    const results = await activityRepo.searchUsersByEmail(parsed.data.q, parsed.data.limit);
    return c.json({ data: { items: results }, error: null });
  });

  return app;
}
