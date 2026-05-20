/**
 * Broadcast HTTP routes (#500). Admin-only — every route is guarded
 * by `nyxidAuthMiddleware()` + `requirePermission("ornn:admin:skill")`,
 * matching the announcements admin surface (#493).
 *
 *   GET    /api/v1/admin/broadcasts
 *   POST   /api/v1/admin/broadcasts
 *   PATCH  /api/v1/admin/broadcasts/:id
 *   DELETE /api/v1/admin/broadcasts/:id
 *
 * Public user-facing read happens through `/api/v1/notifications` —
 * the notifications service merges broadcasts into the per-user feed
 * (see commit 5).
 *
 * Validation is Zod-driven via the schemas in `./schemas`; route
 * handlers translate parse failures into the project's
 * `INVALID_BROADCAST_INPUT` AppError so the global error middleware
 * formats them consistently with the rest of the API.
 *
 * @module domains/broadcasts/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { z } from "zod";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { createBroadcastSchema, patchBroadcastSchema } from "./schemas";
import type { BroadcastService } from "./service";

const ADMIN_PERMISSION = "ornn:admin:skill";

export interface BroadcastRoutesConfig {
  readonly broadcastService: BroadcastService;
}

export function createBroadcastRoutes(
  config: BroadcastRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { broadcastService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const adminGuard = requirePermission(ADMIN_PERMISSION);

  app.get("/admin/broadcasts", auth, adminGuard, async (c) => {
    const items = await broadcastService.listAdmin();
    return c.json({ data: { items }, error: null });
  });

  app.post(
    "/admin/broadcasts",
    auth,
    adminGuard,
    validateBody(createBroadcastSchema, "invalid_broadcast_input"),
    async (c) => {
      const authCtx = getAuth(c);
      const data = getValidatedBody<z.infer<typeof createBroadcastSchema>>(c);
      const created = await broadcastService.create({
        titleI18n: data.titleI18n,
        bodyMarkdownI18n: data.bodyMarkdownI18n,
        createdBy: authCtx.userId,
        recipientUserIds: data.recipientUserIds,
      });
      // 201 + Location per CONVENTIONS.md §3.2 (#458).
      c.header("Location", `/api/v1/admin/broadcasts/${created.id}`);
      return c.json({ data: created, error: null }, 201);
    },
  );

  app.patch(
    "/admin/broadcasts/:id",
    auth,
    adminGuard,
    validateBody(patchBroadcastSchema, "invalid_broadcast_input"),
    async (c) => {
      const authCtx = getAuth(c);
      const id = c.req.param("id");
      const data = getValidatedBody<z.infer<typeof patchBroadcastSchema>>(c);
      const updated = await broadcastService.update(id, {
        titleI18n: data.titleI18n,
        bodyMarkdownI18n: data.bodyMarkdownI18n,
        updatedBy: authCtx.userId,
      });
      return c.json({ data: updated, error: null });
    },
  );

  app.delete("/admin/broadcasts/:id", auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    await broadcastService.delete(id);
    return c.json({ data: { id }, error: null });
  });

  return app;
}
