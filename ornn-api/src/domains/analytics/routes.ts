/**
 * Analytics HTTP routes — read-side only. Event emission happens from
 * server-side hook points (playground chat for executions; the skill
 * detail / json endpoints for pulls).
 *
 *   GET /api/v1/skills/:idOrName/analytics[?window=7d|30d|all][&version=]
 *   GET /api/v1/skills/:idOrName/analytics/pulls
 *       ?bucket=hour|day|month
 *       &from=<iso>
 *       &to=<iso>
 *       &version=<string>
 *
 * Visibility mirrors `GET /skills/:idOrName`: anonymous users can only
 * read analytics of public skills. Private skills require the caller to
 * be able to read the skill.
 *
 * @module domains/analytics/routes
 */

import { Hono, type Context } from "hono";
import {
  type AuthVariables,
  optionalAuthMiddleware,
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { canReadSkill } from "../skills/crud/authorize";
import type { SkillService } from "../skills/crud/service";
import type { AnalyticsService } from "./service";
import type { PullBucket } from "./types";

export interface AnalyticsRoutesConfig {
  readonly analyticsService: AnalyticsService;
  readonly skillService: SkillService;
}

export function createAnalyticsRoutes(
  config: AnalyticsRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { analyticsService, skillService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const optionalAuth = optionalAuthMiddleware();

  // Centralize the visibility check; both routes need it.
  async function authorizeRead(
    c: Context<{ Variables: AuthVariables }>,
    idOrName: string,
  ): Promise<{ skillGuid: string }> {
    const authCtx = c.get("auth");
    const skill = await skillService.getSkill(idOrName);
    if (!authCtx && skill.isPrivate) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
    }
    if (authCtx && skill.isPrivate) {
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canReadSkill(skill, actor)) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }
    }
    return { skillGuid: skill.guid };
  }

  app.get(
    "/skills/:idOrName/analytics",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const windowParam = c.req.query("window") || "30d";
      const versionParam = c.req.query("version") || undefined;
      if (windowParam !== "7d" && windowParam !== "30d" && windowParam !== "all") {
        throw AppError.badRequest(
          "INVALID_WINDOW",
          "'window' must be '7d', '30d', or 'all'",
        );
      }
      const { skillGuid } = await authorizeRead(c, idOrName);
      const summary = await analyticsService.getSummary(skillGuid, windowParam, versionParam);
      return c.json({ data: summary, error: null });
    },
  );

  app.get(
    "/skills/:idOrName/analytics/pulls",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const bucketParam = (c.req.query("bucket") || "day") as string;
      if (bucketParam !== "hour" && bucketParam !== "day" && bucketParam !== "month") {
        throw AppError.badRequest(
          "INVALID_BUCKET",
          "'bucket' must be 'hour', 'day', or 'month'",
        );
      }
      const fromQ = c.req.query("from");
      const toQ = c.req.query("to");
      const from = fromQ ? new Date(fromQ) : undefined;
      const to = toQ ? new Date(toQ) : undefined;
      if (fromQ && from && Number.isNaN(from.getTime())) {
        throw AppError.badRequest("INVALID_RANGE", "'from' is not a valid ISO date");
      }
      if (toQ && to && Number.isNaN(to.getTime())) {
        throw AppError.badRequest("INVALID_RANGE", "'to' is not a valid ISO date");
      }
      if (from && to && from >= to) {
        throw AppError.badRequest("INVALID_RANGE", "'from' must be earlier than 'to'");
      }
      const versionParam = c.req.query("version") || undefined;

      const { skillGuid } = await authorizeRead(c, idOrName);
      const buckets = await analyticsService.getPullsTimeSeries({
        skillGuid,
        bucket: bucketParam as PullBucket,
        from,
        to,
        version: versionParam,
      });
      return c.json({ data: { items: buckets }, error: null });
    },
  );

  return app;
}
