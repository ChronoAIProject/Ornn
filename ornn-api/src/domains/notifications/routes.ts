/**
 * Notification HTTP routes — all scoped to the caller.
 *
 *   GET  /api/v1/notifications                       — merged feed (per-user + broadcasts)
 *   GET  /api/v1/notifications/unread-count          — for header badges
 *   POST /api/v1/notifications/:id/read              — mark one read (notification OR broadcast)
 *   POST /api/v1/notifications/mark-all-read         — mark every unread read
 *
 * After #500 the feed is a discriminated union: rows carry either
 * `source: "user"` (existing per-user notification shape) or
 * `source: "broadcast"` (bilingual markdown from the admin-authored
 * broadcasts collection). `/:id/read` accepts both kinds of id and
 * routes by lookup; unknown ids surface NOTIFICATION_NOT_FOUND as
 * before. `mark-all-read` covers both sources in one shot.
 *
 * @module domains/notifications/routes
 */

import { Hono } from "hono";
import { type AuthVariables, getAuth, nyxidAuthMiddleware } from "../../middleware/nyxidAuth";
import type { NotificationService } from "./service";
import type { FeedItem } from "./types";

export interface NotificationRoutesConfig {
  readonly notificationService: NotificationService;
}

/**
 * Wire-shape feed item — same as `FeedItem` from `./types` but with
 * Dates serialized to ISO strings. Two variants discriminated by
 * `source`; the UI uses the discriminator to render the right kind.
 */
type FeedItemDto =
  | {
      _id: string;
      source: "user";
      userId: string;
      category: string;
      title: string;
      body?: string;
      link?: string;
      data: Record<string, unknown>;
      readAt: string | null;
      createdAt: string;
    }
  | {
      _id: string;
      source: "broadcast";
      titleI18n: { en: string; zh: string };
      bodyMarkdownI18n: { en: string; zh: string };
      createdAt: string;
      readAt: string | null;
    };

function toFeedDto(item: FeedItem): FeedItemDto {
  if (item.source === "broadcast") {
    return {
      _id: item._id,
      source: "broadcast",
      titleI18n: item.titleI18n,
      bodyMarkdownI18n: item.bodyMarkdownI18n,
      createdAt: item.createdAt.toISOString(),
      readAt: item.readAt ? item.readAt.toISOString() : null,
    };
  }
  return {
    _id: item._id,
    source: "user",
    userId: item.userId,
    category: item.category,
    title: item.title,
    // exactOptionalPropertyTypes (#657): conditional spread on
    // optional body/link.
    ...(item.body !== undefined ? { body: item.body } : {}),
    ...(item.link !== undefined ? { link: item.link } : {}),
    data: item.data,
    readAt: item.readAt ? item.readAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
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
    // Parse + finite-validate only. The clamp authority lives in the
    // service (single source of truth) — a malformed/empty `?limit=`
    // (e.g. `abc`, ``) yields NaN here, which we drop to `undefined` so
    // the service falls back to its default page size instead of
    // erroring (#920).
    const limitParam = c.req.query("limit");
    const parsed = limitParam !== undefined ? Number.parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed) ? parsed : undefined;
    const items = await notificationService.listFeedForUser(authCtx.userId, {
      unreadOnly,
      // exactOptionalPropertyTypes (#657)
      ...(limit !== undefined ? { limit } : {}),
    });
    return c.json({ data: { items: items.map(toFeedDto) }, error: null });
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
