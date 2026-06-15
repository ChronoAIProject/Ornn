/**
 * Wire the notifications domain (#580 — bootstrap decomposition).
 *
 * Notifications consumes the shared `BroadcastRepository` (built by
 * the broadcasts wiring) on the merged-feed path. The caller is
 * expected to construct the broadcasts repo first via
 * `wireBroadcastsRepo`, then pass that repo into `wireNotifications`.
 *
 * Also runs a one-time legacy-category cleanup migration (#218 — drop
 * `share.*` notification rows) so the consumer UI doesn't surface
 * stale rows from the pre-#198 share/audit-gate workflow.
 *
 * @module domains/notifications/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { NotificationRepository } from "./repository";
import { NotificationService } from "./service";
import { createNotificationRoutes } from "./routes";
import { dropLegacyNotificationCategories } from "./migration";
import type { BroadcastRepository } from "../broadcasts/repository";

export interface NotificationsWiring {
  readonly service: NotificationService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
  /** Exposed so other domains (e.g. launch-promo) can publish per-user
   *  notifications without re-instantiating the repo. */
  readonly repo: NotificationRepository;
}

export async function wireNotifications(deps: {
  db: Db;
  logger: Logger;
  broadcastRepo: BroadcastRepository;
}): Promise<NotificationsWiring> {
  const repo = new NotificationRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "notifications indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  // One-time boot migration (#218) — drop legacy `share.*` rows left
  // over from the pre-#198 share/audit-gate workflow. Idempotent; no-op
  // after first run. Failure is non-fatal — old rows surface as ugly
  // UI but never block the boot.
  await dropLegacyNotificationCategories(deps.db).catch((err) =>
    deps.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "dropLegacyNotificationCategories failed — legacy notification rows may still surface in /notifications until the next deploy",
    ),
  );
  const service = new NotificationService({
    notificationRepo: repo,
    broadcastRepo: deps.broadcastRepo,
  });
  const routes = createNotificationRoutes({ notificationService: service });
  return { service, routes, repo };
}
