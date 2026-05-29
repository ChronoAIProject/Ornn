/**
 * Wire the analytics domain (#580 — bootstrap decomposition).
 *
 * Pure leaf wiring: repo (with fire-and-forget index ensure for both
 * `skill_executions` + `skill_pulls` collections) → service → routes.
 * Routes also need the skill-service reference to join skill metadata
 * onto execution rows, so the caller passes it in.
 *
 * @module domains/analytics/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { Logger } from "pino";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { AnalyticsRepository } from "./repository";
import { AnalyticsService } from "./service";
import { createAnalyticsRoutes } from "./routes";
import type { SkillService } from "../skills/crud/service";

export interface AnalyticsWiring {
  readonly service: AnalyticsService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wireAnalytics(deps: {
  db: Db;
  logger: Logger;
  skillService: SkillService;
}): AnalyticsWiring {
  const repo = new AnalyticsRepository(deps.db);
  void repo.ensureIndexes().catch((err) =>
    deps.logger.warn(
      { err },
      "skill_executions indexes ensureIndexes failed — proceeding anyway",
    ),
  );
  const service = new AnalyticsService({ analyticsRepo: repo });
  const routes = createAnalyticsRoutes({
    analyticsService: service,
    skillService: deps.skillService,
  });
  return { service, routes };
}
