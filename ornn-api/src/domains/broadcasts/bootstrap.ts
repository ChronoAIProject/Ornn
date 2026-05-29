/**
 * Wire the broadcasts domain (#580 — bootstrap decomposition).
 *
 * Broadcasts and notifications share the same `BroadcastRepository`
 * instance: notifications reads from it on the merged-feed path
 * (#500 left-join with read receipts), broadcasts writes through its
 * own service on admin CRUD. A single shared instance keeps the
 * read/write surfaces consistent without a second TTL or cache layer.
 *
 * Wiring order is deliberate — the repo is built FIRST so the
 * `wireNotifications` call can take a reference to it, then the
 * broadcast service + routes are built on top of the same repo.
 *
 * @module domains/broadcasts/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { BroadcastRepository } from "./repository";
import { BroadcastService } from "./service";
import { createBroadcastRoutes } from "./routes";
import { backfillBroadcastRecipientUserIds } from "./migration";

export interface BroadcastsRepoWiring {
  readonly repo: BroadcastRepository;
}

export interface BroadcastsWiring extends BroadcastsRepoWiring {
  readonly service: BroadcastService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

/**
 * Step 1 — construct the repo + run the one-shot bilingual + targeting
 * backfill migration. Notifications wiring needs the repo reference
 * before its own service is built; this entry point gives it that
 * without forcing broadcasts to construct its service + routes prematurely.
 *
 * Pre-#502 docs don't carry `recipientUserIds`; the migration writes
 * an explicit `null` on every absent doc so the merged feed can rely
 * on a stable `string[] | null` shape. Idempotent; failure is
 * non-fatal — the repo mapper's `Array.isArray` guard already
 * normalises absent fields to `null` on the read path.
 */
export async function wireBroadcastsRepo(deps: {
  db: Db;
  logger: Logger;
}): Promise<BroadcastsRepoWiring> {
  const repo = new BroadcastRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "broadcasts indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  await backfillBroadcastRecipientUserIds(deps.db, deps.logger).catch((err) =>
    deps.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "broadcasts recipientUserIds backfill crashed — mapper fallback will cover reads, retry on next boot",
    ),
  );
  return { repo };
}

/**
 * Step 2 — build the service + routes on the shared repo. Called
 * after `wireNotifications` so the merged feed has already taken
 * its repo reference (no functional dependency, just an ordering
 * preference that matches the original bootstrap flow).
 */
export function wireBroadcasts(deps: {
  repo: BroadcastRepository;
}): { service: BroadcastService; routes: Hono<{ Variables: AuthVariables }> } {
  const service = new BroadcastService({ repo: deps.repo });
  const routes = createBroadcastRoutes({ broadcastService: service });
  return { service, routes };
}
