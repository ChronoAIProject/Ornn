/**
 * Wire the announcements domain (#580 — bootstrap decomposition).
 *
 * Pure leaf wiring: repo → ensureIndexes (fire-and-forget) → one-shot
 * bilingual backfill migration → service → routes. The boot caller
 * stays in charge of ordering — this function just bundles the per-
 * domain construction detail.
 *
 * @module domains/announcements/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { AnnouncementRepository } from "./repository";
import { AnnouncementService } from "./service";
import { createAnnouncementRoutes } from "./routes";
import { migrateAnnouncementsToBilingual } from "./migration";

export interface AnnouncementsWiring {
  readonly service: AnnouncementService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

/**
 * Construct repo + service + routes for announcements and queue the
 * one-shot bilingual backfill. Returns the routes (mount on the API
 * sub-app) plus the service (no current consumer needs it externally,
 * but exposing it keeps the contract symmetric with other domains).
 *
 * Migration failure is non-fatal: the repo's mapper falls back to
 * legacy single-locale fields, so reads stay correct even when the
 * migration hasn't run yet.
 */
export async function wireAnnouncements(deps: {
  db: Db;
  logger: Logger;
}): Promise<AnnouncementsWiring> {
  const repo = new AnnouncementRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "announcements indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  // One-shot bilingual backfill: copies legacy single-locale columns
  // (title / bodyMarkdown / ctaLabel) into the new per-locale slots
  // (`*En` + `*Zh`). Idempotent — second boot is a no-op. Failure is
  // logged + non-fatal; the repo's mapper falls back to legacy fields.
  await migrateAnnouncementsToBilingual(deps.db, deps.logger).catch((err) =>
    deps.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "announcements bilingual migration crashed — repo fallback will cover reads, retry on next boot",
    ),
  );
  const service = new AnnouncementService({ repo });
  const routes = createAnnouncementRoutes({ announcementService: service });
  return { service, routes };
}
