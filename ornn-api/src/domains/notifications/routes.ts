/**
 * Notification HTTP routes — all scoped to the caller.
 *
 *   GET  /api/v1/notifications                       — list (default limit 50, max 200)
 *   GET  /api/v1/notifications/unread-count          — for header badges
 *   POST /api/v1/notifications/:id/read              — mark one read
 *   POST /api/v1/notifications/mark-all-read         — mark every unread read
 *
 * @module domains/notifications/routes
 */

import { Hono } from "hono";
import { type AuthVariables, getAuth, nyxidAuthMiddleware } from "../../middleware/nyxidAuth";
import type { NotificationService } from "./service";

export interface NotificationRoutesConfig {
  readonly notificationService: NotificationService;
}

export function createNotificationRoutes(
  config: NotificationRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { notificationService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get("/notifications", auth, async (c) => {
    const authCtx = getAuth(c);
    const unreadOnly = c.req.query("unread") === "true";
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.max(1, Math.min(200, Number.parseInt(limitParam, 10))) : undefined;
    const items = await notificationService.list(authCtx.userId, { unreadOnly, limit });
    return c.json({ data: { items }, error: null });
  });

  app.get("/notifications/unread-count", auth, async (c) => {
    const authCtx = getAuth(c);
    const count = await notificationService.countUnread(authCtx.userId);
    return c.json({ data: { count }, error: null });
  });

  app.post("/notifications/:id/read", auth, async (c) => {
    const authCtx = getAuth(c);
    const id = c.req.param("id");
    const updated = await notificationService.markRead(authCtx.userId, id);
    return c.json({ data: updated, error: null });
  });

  app.post("/notifications/mark-all-read", auth, async (c) => {
    const authCtx = getAuth(c);
    const updated = await notificationService.markAllRead(authCtx.userId);
    return c.json({ data: { updated }, error: null });
  });

  return app;
}
