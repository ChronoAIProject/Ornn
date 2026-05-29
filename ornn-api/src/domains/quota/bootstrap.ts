/**
 * Wire the quota domain (#580 — bootstrap decomposition).
 *
 * Quota is a downstream consumer of `settingsService` (for the
 * per-surface default-monthly-allotment fallback) and
 * `notificationService` (for the over-threshold warning fan-out). The
 * service is exported because three other domains mount it as a
 * dependency: playground, skill-gen, and admin (admin quota CRUD).
 *
 * @module domains/quota/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { QuotaRepository } from "./repository";
import { QuotaService } from "./service";
import { createQuotaRoutes } from "./routes";
import type { NotificationService } from "../notifications/service";
import type { SettingsService } from "../settings/types";

export interface QuotaWiring {
  readonly service: QuotaService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wireQuota(deps: {
  db: Db;
  logger: Logger;
  settingsService: SettingsService;
  notificationService: NotificationService;
}): QuotaWiring {
  const repo = new QuotaRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "quota indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  const service = new QuotaService({
    repo,
    defaults: {
      // The "raise the default mid-month" headroom rule is implemented
      // inside QuotaService; this resolver just hands it the current
      // section values whenever it asks.
      getQuotaDefaults: async () => {
        const [pg, sg] = await Promise.all([
          deps.settingsService.getPlayground(),
          deps.settingsService.getSkillGen(),
        ]);
        return {
          defaultPlaygroundMonthly: pg.defaultMonthlyQuota,
          defaultSkillGenMonthly: sg.defaultMonthlyQuota,
        };
      },
    },
    notificationService: deps.notificationService,
  });
  const routes = createQuotaRoutes({ quotaService: service });
  return { service, routes };
}
