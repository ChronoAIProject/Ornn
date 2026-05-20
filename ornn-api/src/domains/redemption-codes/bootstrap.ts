/**
 * Wire the redemption-codes domain (#580 — bootstrap decomposition).
 *
 * Consumes `quotaService` (every redeem fans out into per-surface quota
 * grants). Exposes BOTH route surfaces — `/admin/redemption-codes` for
 * mint/list/invalidate and `/me/redemption-codes/redeem` for the user
 * side. Both share a single RedemptionCodeService instance so the
 * atomic `findOneAndUpdate` pivots inside the service stay consistent.
 *
 * @module domains/redemption-codes/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { RedemptionCodeRepository } from "./repository";
import { RedemptionCodeService } from "./service";
import { createMeRedemptionCodesRoutes } from "./me-routes";
import { createAdminRedemptionCodesRoutes } from "../admin/redemption-codes/routes";
import type { QuotaService } from "../quota/service";

export interface RedemptionCodesWiring {
  readonly service: RedemptionCodeService;
  readonly adminRoutes: Hono<{ Variables: AuthVariables }>;
  readonly meRoutes: Hono<{ Variables: AuthVariables }>;
}

export function wireRedemptionCodes(deps: {
  db: Db;
  logger: Logger;
  quotaService: QuotaService;
}): RedemptionCodesWiring {
  const repo = new RedemptionCodeRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "redemption_codes indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  const service = new RedemptionCodeService({
    repo,
    quotaService: deps.quotaService,
  });
  const adminRoutes = createAdminRedemptionCodesRoutes({
    redemptionCodeService: service,
  });
  const meRoutes = createMeRedemptionCodesRoutes({
    redemptionCodeService: service,
  });
  return { service, adminRoutes, meRoutes };
}
