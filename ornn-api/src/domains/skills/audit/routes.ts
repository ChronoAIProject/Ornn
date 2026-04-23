/**
 * Skill-audit HTTP routes.
 *
 * - GET  /api/v1/skills/:idOrName/audit                — latest audit (cache; does NOT trigger)
 * - POST /api/v1/admin/skills/:idOrName/audit          — manual re-audit (admin only)
 *
 * The audit-on-share trigger lands in a later PR (#95). For now, only
 * explicit admin calls run the LLM pipeline.
 *
 * @module domains/skills/audit/routes
 */

import { Hono } from "hono";
import pino from "pino";
import type { AuditService } from "./service";
import type { SkillService } from "../crud/service";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  readUserOrgMemberships,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import { canReadSkill } from "../crud/authorize";

const logger = pino({ level: "info" }).child({ module: "auditRoutes" });

export interface AuditRoutesConfig {
  auditService: AuditService;
  skillService: SkillService;
}

export function createAuditRoutes(config: AuditRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { auditService, skillService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * GET /skills/:idOrName/audit
   * Returns the most recent audit for the skill's current latest version,
   * or for a specific version via `?version=` query. Does NOT trigger a
   * new audit.
   * Visibility: same as GET /skills/:idOrName.
   */
  app.get(
    "/skills/:idOrName/audit",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const version = c.req.query("version") || undefined;
      const authCtx = c.get("auth");

      const skill = await skillService.getSkill(idOrName, version);

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

      const record = await auditService.getAudit(idOrName, version);
      if (!record) {
        // No audit yet — surface that as 404 so callers can distinguish
        // from a record that returned zeroes.
        throw AppError.notFound("AUDIT_NOT_FOUND", "No audit has been run for this skill version");
      }
      return c.json({ data: record, error: null });
    },
  );

  /**
   * POST /admin/skills/:idOrName/audit
   * Force a fresh audit. Admin only.
   * Body: `{ force?: boolean }` — `force=true` bypasses the cache.
   */
  app.post(
    "/admin/skills/:idOrName/audit",
    auth,
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = getAuth(c);
      const body = (await c.req.json().catch(() => ({}))) as { force?: unknown };
      const force = body.force === true;

      logger.info({ idOrName, triggeredBy: authCtx.userId, force }, "Manual audit triggered");
      const record = await auditService.runAudit(idOrName, {
        triggeredBy: authCtx.userId,
        force,
      });
      return c.json({ data: record, error: null });
    },
  );

  return app;
}
