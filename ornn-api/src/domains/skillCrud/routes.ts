/**
 * Skill CRUD routes with NyxID permission-based auth.
 * POST /api/skills         — create (ornn:skill:create)
 * GET  /api/skills/:idOrName — read  (ornn:skill:read)
 * PUT  /api/skills/:id     — update (ornn:skill:update + owner/admin)
 * DELETE /api/skills/:id   — delete (ornn:skill:delete + owner/admin)
 * @module domains/skillCrud/routes
 */

import { Hono } from "hono";
import type { SkillService } from "./service";
import type { SkillRepository } from "./repository";
import type { ActivityRepository } from "../admin/activityRepository";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  requirePermission,
  requireOwnerOrAdmin,
  getAuth,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillCrudRoutes" });

export interface SkillRoutesConfig {
  skillService: SkillService;
  skillRepo: SkillRepository;
  maxFileSize: number;
  activityRepo?: ActivityRepository;
}

export function createSkillRoutes(config: SkillRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { skillService, skillRepo, maxFileSize, activityRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * POST /skills — Create a new skill from a ZIP package.
   * Requires: ornn:skill:create
   */
  app.post(
    "/skills",
    auth,
    requirePermission("ornn:skill:create"),
    async (c) => {
      const authCtx = getAuth(c);
      const skipValidation = c.req.query("skip_validation") === "true";

      const contentType = c.req.header("content-type") ?? "";
      if (!contentType.includes("application/zip") && !contentType.includes("application/octet-stream")) {
        throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected application/zip content type");
      }

      const body = await c.req.arrayBuffer();
      if (!body || body.byteLength === 0) {
        throw AppError.badRequest("EMPTY_BODY", "Request body is empty");
      }

      if (body.byteLength > maxFileSize) {
        throw AppError.payloadTooLarge("File exceeds maximum upload size");
      }

      const zipBuffer = new Uint8Array(body);
      const userEmail = c.req.header("X-User-Email") ?? undefined;
      const userDisplayName = c.req.header("X-User-Display-Name") ?? undefined;
      const result = await skillService.createSkill(zipBuffer, authCtx.userId, {
        skipValidation,
        userEmail,
        userDisplayName,
      });
      logger.info({ guid: result.guid, userId: authCtx.userId, userEmail }, "Skill created via API");

      // Log activity
      const skill = await skillService.getSkill(result.guid);
      activityRepo?.log(authCtx.userId, userEmail ?? "", userDisplayName ?? "", "skill:create", {
        skillId: result.guid,
        skillName: skill.name,
      }).catch((err) => logger.warn({ err }, "Failed to log skill:create activity"));

      return c.json({ data: skill, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/json — Return skill package as JSON with all file contents.
   * Requires: ornn:skill:read
   */
  app.get(
    "/skills/:idOrName/json",
    auth,
    requirePermission("ornn:skill:read"),
    async (c) => {
      const idOrName = c.req.param("idOrName");
      logger.info({ idOrName }, "Skill jsonize request");
      const result = await skillService.getSkillJson(idOrName);
      return c.json({ data: result, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/versions — List all published versions, newest first.
   * Visibility rules match GET /skills/:idOrName.
   */
  app.get(
    "/skills/:idOrName/versions",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = c.get("auth");

      // Reuse getSkill for the visibility check; we throw SKILL_NOT_FOUND for
      // unauthenticated readers of private skills, matching the existing rule.
      const skill = await skillService.getSkill(idOrName);
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }
      if (authCtx && skill.isPrivate && skill.createdBy !== authCtx.userId && !authCtx.permissions.includes("ornn:admin:skill")) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }

      const items = await skillService.listSkillVersions(idOrName);
      return c.json({ data: { items }, error: null });
    },
  );

  /**
   * GET /skills/:idOrName — Read a skill by GUID or name.
   * Query params:
   *   - version: optional `<major>.<minor>` — when set, return that version's
   *     package (storageKey, metadata, hash). When omitted, return the latest.
   * Auth: Optional. Anonymous users can only view public skills.
   */
  app.get(
    "/skills/:idOrName",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const version = c.req.query("version") || undefined;
      const authCtx = c.get("auth");
      const skill = await skillService.getSkill(idOrName, version);

      // Anonymous users can only see public skills
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }

      // Authenticated non-owner can't see private skills (unless admin)
      if (authCtx && skill.isPrivate && skill.createdBy !== authCtx.userId && !authCtx.permissions.includes("ornn:admin:skill")) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }

      return c.json({ data: skill, error: null });
    },
  );

  /**
   * PUT /skills/:id — Update a skill.
   * Requires: ornn:skill:update + owner or admin
   * Accepts: application/zip, multipart/form-data, application/json
   */
  app.put(
    "/skills/:id",
    auth,
    requirePermission("ornn:skill:update"),
    requireOwnerOrAdmin(async (c) => {
      const guid = c.req.param("id");
      const skill = await skillRepo.findByGuid(guid);
      return skill?.createdBy ?? "";
    }),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const contentType = c.req.header("content-type") ?? "";
      const skipValidation = c.req.query("skip_validation") === "true";

      let zipBuffer: Uint8Array | undefined;
      let isPrivate: boolean | undefined;

      if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
        const body = await c.req.arrayBuffer();
        if (body && body.byteLength > 0) {
          if (body.byteLength > maxFileSize) {
            throw AppError.payloadTooLarge("File exceeds maximum upload size");
          }
          zipBuffer = new Uint8Array(body);
        }
      } else if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.parseBody({ all: true });
        const packageFile = formData["package"];
        if (packageFile instanceof File) {
          if (packageFile.size > maxFileSize) {
            throw AppError.payloadTooLarge("File exceeds maximum upload size");
          }
          const buf = await packageFile.arrayBuffer();
          zipBuffer = new Uint8Array(buf);
        }
        if (formData["isPrivate"] !== undefined) {
          isPrivate = String(formData["isPrivate"]) === "true";
        }
      } else if (contentType.includes("application/json")) {
        const body = await c.req.json();
        if (body.isPrivate !== undefined) {
          isPrivate = Boolean(body.isPrivate);
        }
      }

      if (zipBuffer === undefined && isPrivate === undefined) {
        throw AppError.badRequest("NO_UPDATE", "No update data provided. Send a ZIP file and/or isPrivate field.");
      }

      logger.info({ guid, userId: authCtx.userId }, "Skill update via API");
      const userEmail = c.req.header("X-User-Email") ?? "";
      const userDN = c.req.header("X-User-Display-Name") ?? "";
      const result = await skillService.updateSkill(guid, authCtx.userId, {
        zipBuffer,
        isPrivate,
        skipValidation,
        userEmail: userEmail || undefined,
        userDisplayName: userDN || undefined,
      });

      const action = isPrivate !== undefined && zipBuffer === undefined ? "skill:visibility_change" : "skill:update";
      activityRepo?.log(authCtx.userId, userEmail, userDN, action, {
        skillId: guid,
        skillName: result.name,
        ...(isPrivate !== undefined ? { isPrivate } : {}),
      }).catch((err) => logger.warn({ err }, `Failed to log ${action} activity`));

      return c.json({ data: result, error: null });
    },
  );

  /**
   * DELETE /skills/:id — Hard-delete a skill.
   * Requires: ornn:skill:delete + owner or admin
   */
  app.delete(
    "/skills/:id",
    auth,
    requirePermission("ornn:skill:delete"),
    requireOwnerOrAdmin(async (c) => {
      const guid = c.req.param("id");
      const skill = await skillRepo.findByGuid(guid);
      return skill?.createdBy ?? "";
    }),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const skill = await skillRepo.findByGuid(guid);
      logger.info({ guid }, "Skill delete via API");
      await skillService.deleteSkill(guid);

      const userEmail = c.req.header("X-User-Email") ?? "";
      const userDN = c.req.header("X-User-Display-Name") ?? "";
      activityRepo?.log(authCtx.userId, userEmail, userDN, "skill:delete", {
        skillId: guid,
        skillName: skill?.name ?? guid,
      }).catch((err) => logger.warn({ err }, "Failed to log skill:delete activity"));

      return c.json({ data: { success: true }, error: null });
    },
  );

  return app;
}
