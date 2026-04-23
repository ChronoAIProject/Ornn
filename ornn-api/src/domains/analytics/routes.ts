/**
 * Analytics HTTP routes — read-side only. Event emission happens from
 * server-side hook points (playground today).
 *
 *   GET /api/v1/skills/:idOrName/analytics[?window=7d|30d|all]
 *
 * Visibility mirrors `GET /skills/:idOrName`: anonymous users can only
 * read analytics of public skills. Private skills require the caller to
 * be able to read the skill.
 *
 * @module domains/analytics/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  optionalAuthMiddleware,
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { canReadSkill } from "../skills/crud/authorize";
import type { SkillService } from "../skills/crud/service";
import type { AnalyticsService } from "./service";

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

  app.get(
    "/skills/:idOrName/analytics",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const windowParam = c.req.query("window") || "30d";
      if (windowParam !== "7d" && windowParam !== "30d" && windowParam !== "all") {
        throw AppError.badRequest(
          "INVALID_WINDOW",
          "'window' must be '7d', '30d', or 'all'",
        );
      }
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
      const summary = await analyticsService.getSummary(skill.guid, windowParam);
      return c.json({ data: summary, error: null });
    },
  );

  return app;
}
