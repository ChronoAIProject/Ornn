/**
 * Launch-promo domain bootstrap (#724) — repo + service + routes.
 *
 * The cron loop + GitHub stargazers HTTP client + NyxID GH-login
 * resolver land in a follow-up PR. This bootstrap exposes everything
 * needed for the admin manual-award + caller-status endpoints to work
 * today.
 *
 * @module domains/launchPromo/bootstrap
 */

import type { Hono } from "hono";
import type { Db } from "mongodb";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { LaunchPromoRepository } from "./repository";
import { LaunchPromoService } from "./service";
import { createLaunchPromoRoutes } from "./routes";
import type { SettingsService } from "../settings/types";
import type { RedemptionCodeService } from "../redemption-codes/service";
import type { NotificationRepository } from "../notifications/repository";
import type { UserDirectoryRepository } from "../users/repository";

export interface LaunchPromoWiring {
  readonly service: LaunchPromoService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export interface LaunchPromoWiringDeps {
  db: Db;
  settingsService: SettingsService;
  redemptionCodeService: RedemptionCodeService;
  notificationRepo: NotificationRepository;
  userDirectoryRepo: UserDirectoryRepository;
}

export async function wireLaunchPromo(
  deps: LaunchPromoWiringDeps,
): Promise<LaunchPromoWiring> {
  const repo = new LaunchPromoRepository(deps.db);
  await repo.ensureIndexes().catch(() => {
    /* index creation is best-effort; first write still succeeds without it */
  });

  const service = new LaunchPromoService({
    repo,
    userDirectoryRepo: deps.userDirectoryRepo,
    settingsService: deps.settingsService,
    redemptionCodeService: deps.redemptionCodeService,
    notificationRepo: deps.notificationRepo,
  });

  const routes = createLaunchPromoRoutes({ service });

  return { service, routes };
}
