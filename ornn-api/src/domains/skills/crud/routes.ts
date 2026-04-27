/**
 * Skill CRUD routes with NyxID permission-based auth.
 * POST /api/skills         — create (ornn:skill:create)
 * GET  /api/skills/:idOrName — read  (ornn:skill:read)
 * PUT  /api/skills/:id     — update (ornn:skill:update + owner/admin)
 * DELETE /api/skills/:id   — delete (ornn:skill:delete + owner/admin)
 * @module domains/skills/crud/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { SkillService } from "./service";
import type { SkillRepository } from "./repository";
import type { ActivityRepository } from "../../admin/activityRepository";
import type { ShareService } from "../../shares/service";
import type { ShareRequest } from "../../shares/types";
import type { AnalyticsService } from "../../analytics/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  requirePermission,
  getAuth,
  readUserOrgMemberships,
} from "../../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
import { canReadSkill, canManageSkill } from "./authorize";
import pino from "pino";

const deprecationPatchSchema = z.object({
  isDeprecated: z.boolean(),
  deprecationNote: z.string().max(1024).optional(),
});

/**
 * Schema for `PUT /api/skills/:id/permissions`. `isPrivate === false`
 * means fully public; the shared-with lists are still persisted in that
 * case (no reason to wipe them — the author can flip back to private
 * without losing their collaborator list).
 */
const permissionsPatchSchema = z.object({
  isPrivate: z.boolean(),
  sharedWithUsers: z.array(z.string().min(1).max(128)).max(500).default([]),
  sharedWithOrgs: z.array(z.string().min(1).max(128)).max(100).default([]),
});

const logger = pino({ level: "info" }).child({ module: "skillCrudRoutes" });

export interface SkillRoutesConfig {
  skillService: SkillService;
  skillRepo: SkillRepository;
  /**
   * Owns the audit-gated share lifecycle. Invoked from the permissions
   * handler when the owner adds a new grant — `initiateShare` runs the
   * audit, decides green/needs-justification, and either applies the
   * grant or creates a waiver request depending on the configurable
   * platform threshold.
   */
  shareService: ShareService;
  /**
   * Optional. When provided, GET routes fire-and-forget pull events into
   * `skill_pulls` so the usage chart on `SkillDetailPage` has data.
   * Errors are swallowed in the service layer, never surfaced to clients.
   */
  analyticsService?: AnalyticsService;
  maxFileSize: number;
  activityRepo?: ActivityRepository;
}

export function createSkillRoutes(config: SkillRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { skillService, skillRepo, shareService, analyticsService, maxFileSize, activityRepo } = config;
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
      const userEmail = authCtx.email || undefined;
      const userDisplayName = authCtx.displayName || undefined;

      // New skills are always created as private with no shared-with entries.
      // Visibility is managed afterward via PUT /api/skills/:id/permissions.
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
   * POST /skills/pull — Create a skill by pulling from a public GitHub repo.
   * Body: { repo: "owner/name", ref?: string, path?: string }
   * Requires: ornn:skill:create
   *
   * This creates a one-way link GitHub → Ornn: subsequent updates to the
   * upstream repo can be brought in via POST /skills/:id/refresh without
   * re-uploading a ZIP.
   */
  app.post(
    "/skills/pull",
    auth,
    requirePermission("ornn:skill:create"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = (await c.req.json().catch(() => ({}))) as {
        repo?: unknown;
        ref?: unknown;
        path?: unknown;
        skip_validation?: unknown;
      };

      if (typeof body.repo !== "string" || !body.repo) {
        throw AppError.badRequest("MISSING_REPO", "A 'repo' field (format 'owner/name') is required");
      }

      const ref = typeof body.ref === "string" && body.ref ? body.ref : undefined;
      const path = typeof body.path === "string" ? body.path : undefined;
      const skipValidation = body.skip_validation === true;
      const userEmail = authCtx.email || undefined;
      const userDisplayName = authCtx.displayName || undefined;

      try {
        const { guid } = await skillService.createSkillFromGitHub(
          { repo: body.repo, ref, path },
          authCtx.userId,
          { userEmail, userDisplayName, skipValidation },
        );
        const skill = await skillService.getSkill(guid);

        logger.info(
          { guid, userId: authCtx.userId, repo: body.repo, ref, path },
          "Skill created via GitHub pull",
        );

        activityRepo
          ?.log(authCtx.userId, userEmail ?? "", userDisplayName ?? "", "skill:create", {
            skillId: guid,
            skillName: skill.name,
            source: "github-pull",
          })
          .catch((err) => logger.warn({ err }, "Failed to log skill:create activity"));

        return c.json({ data: skill, error: null });
      } catch (err) {
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw AppError.badRequest("PULL_FAILED", message);
      }
    },
  );

  /**
   * POST /skills/:id/refresh — Re-pull a skill's package from its stored
   * GitHub source and publish as a new version.
   * Requires: ornn:skill:update, and caller must be the skill's author or a
   * platform admin.
   */
  app.post(
    "/skills/:id/refresh",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const authCtx = getAuth(c);
      const guid = c.req.param("id");

      const existing = await skillService.getSkill(guid);
      const isPlatformAdmin = authCtx.permissions.includes("ornn:admin:skill");
      if (existing.createdBy !== authCtx.userId && !isPlatformAdmin) {
        throw AppError.forbidden(
          "NOT_SKILL_OWNER",
          "Only the skill's author or a platform admin may refresh it",
        );
      }

      try {
        const refreshed = await skillService.refreshSkillFromSource(guid, authCtx.userId, {
          userEmail: authCtx.email || undefined,
          userDisplayName: authCtx.displayName || undefined,
        });

        logger.info(
          { guid, userId: authCtx.userId, newCommit: refreshed.source?.lastSyncedCommit },
          "Skill refreshed from GitHub source",
        );

        activityRepo
          ?.log(
            authCtx.userId,
            authCtx.email ?? "",
            authCtx.displayName ?? "",
            "skill:refresh",
            {
              skillId: guid,
              skillName: refreshed.name,
              commit: refreshed.source?.lastSyncedCommit,
            },
          )
          .catch((err) => logger.warn({ err }, "Failed to log skill:refresh activity"));

        return c.json({ data: refreshed, error: null });
      } catch (err) {
        if (err instanceof AppError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw AppError.badRequest("REFRESH_FAILED", message);
      }
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
      // Programmatic pull — closest signal to the north-star metric.
      // Fire-and-forget; the analytics service swallows its own errors.
      const authCtx = c.get("auth");
      if (analyticsService && authCtx) {
        void skillService
          .getSkill(idOrName)
          .then((skill) =>
            analyticsService.recordPull({
              skillGuid: skill.guid,
              skillName: skill.name,
              skillVersion: skill.version,
              userId: authCtx.userId,
              source: "api",
            }),
          )
          .catch(() => {
            /* analytics failures must not surface to the caller */
          });
      }
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

      const skill = await skillService.getSkill(idOrName);
      // Anonymous viewers only see public skills.
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

      const items = await skillService.listSkillVersions(idOrName);
      return c.json({ data: { items }, error: null });
    },
  );

  /**
   * GET /skills/:idOrName/versions/:fromVersion/diff/:toVersion
   *
   * Return a structured diff between two versions. File-level
   * (added/removed/modified) plus text content on both sides for the UI
   * to render line-level diffs client-side. Visibility rules match
   * GET /skills/:idOrName.
   *
   * Auth: Optional. Anonymous users can only diff public skills.
   */
  app.get(
    "/skills/:idOrName/versions/:fromVersion/diff/:toVersion",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const fromVersion = c.req.param("fromVersion");
      const toVersion = c.req.param("toVersion");
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

      const result = await skillService.diffVersions(idOrName, fromVersion, toVersion);
      return c.json({ data: result, error: null });
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

      // Anonymous users can only see public skills.
      if (!authCtx && skill.isPrivate) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }

      // Authenticated users: apply the full ownership/org-visibility rules.
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

      // Signal deprecation via response headers so non-JSON-aware clients
      // (CLIs, agents) still get the warning. Notes are URL-encoded to keep
      // header values ASCII-safe per RFC 7230.
      if (skill.isDeprecated) {
        c.header("X-Skill-Deprecated", "true");
        if (skill.deprecationNote) {
          c.header("X-Skill-Deprecation-Note", encodeURIComponent(skill.deprecationNote));
        }
      }

      // Web-side pull. The detail endpoint is what the SkillDetailPage
      // hits to mint the presigned URL the browser then downloads from
      // — recording the GET here is a reasonable proxy for "user pulled
      // via the web UI". Fire-and-forget.
      if (analyticsService && authCtx) {
        void analyticsService.recordPull({
          skillGuid: skill.guid,
          skillName: skill.name,
          skillVersion: skill.version,
          userId: authCtx.userId,
          source: "web",
        });
      }

      return c.json({ data: skill, error: null });
    },
  );

  /**
   * PATCH /skills/:idOrName/versions/:version
   * Toggle the deprecation flag on a specific version.
   * Requires: ornn:skill:update + owner or admin on the skill.
   */
  app.patch(
    "/skills/:idOrName/versions/:version",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(deprecationPatchSchema, "INVALID_DEPRECATION_PATCH"),
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const version = c.req.param("version");
      const authCtx = getAuth(c);

      const existing =
        (await skillRepo.findByGuid(idOrName)) ??
        (await skillRepo.findByName(idOrName));
      if (!existing) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "FORBIDDEN",
          "You do not have permission to manage this skill",
        );
      }

      const body = getValidatedBody<z.infer<typeof deprecationPatchSchema>>(c);
      const result = await skillService.setVersionDeprecation(
        idOrName,
        version,
        body.isDeprecated,
        body.deprecationNote ?? null,
      );

      activityRepo
        ?.log(authCtx.userId, authCtx.email, authCtx.displayName, "skill:update", {
          skillId: result.skillGuid,
          skillName: result.skillName,
          version: result.version,
          isDeprecated: result.isDeprecated,
          deprecationChange: true,
        })
        .catch((err) => logger.warn({ err }, "Failed to log skill:deprecation activity"));

      return c.json({ data: result, error: null });
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
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const contentType = c.req.header("content-type") ?? "";
      const skipValidation = c.req.query("skip_validation") === "true";

      const existing = await skillRepo.findByGuid(guid);
      if (!existing) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "FORBIDDEN",
          "You do not have permission to update this skill",
        );
      }

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
      const result = await skillService.updateSkill(guid, authCtx.userId, {
        zipBuffer,
        isPrivate,
        skipValidation,
        userEmail: authCtx.email || undefined,
        userDisplayName: authCtx.displayName || undefined,
      });

      const action = isPrivate !== undefined && zipBuffer === undefined ? "skill:visibility_change" : "skill:update";
      activityRepo?.log(authCtx.userId, authCtx.email, authCtx.displayName, action, {
        skillId: guid,
        skillName: result.name,
        ...(isPrivate !== undefined ? { isPrivate } : {}),
      }).catch((err) => logger.warn({ err }, `Failed to log ${action} activity`));

      return c.json({ data: result, error: null });
    },
  );

  /**
   * PUT /skills/:id/permissions — audit-gated visibility change.
   *
   * Body: `{ isPrivate, sharedWithUsers, sharedWithOrgs }`.
   * Requires: ornn:skill:update + author (or platform admin).
   *
   * The handler diffs the posted state against the current ACL and splits
   * the save into two halves:
   *
   * 1. Removals (user / org grants taken away, flip-to-private) → applied
   *    immediately via `setSkillPermissions`. No audit; access is being
   *    revoked.
   * 2. Additions (new user grant, new org grant, flip-to-public) → each
   *    target goes through `shareService.initiateShare`, which runs a
   *    cached audit (30-day TTL) and either:
   *      - `overallScore >= platformSettings.auditWaiverThreshold` →
   *        status `green`; ACL entry applied synchronously.
   *      - `overallScore <  threshold` → status `needs-justification`;
   *        waiver request created for the owner to justify + a reviewer
   *        to decide.
   *
   * Response: `{ skill, waivers }` — skill reflects any immediately-applied
   * changes; `waivers` carries the per-target `ShareRequest` for anything
   * that needs follow-up. A flip-to-public with any added user / org is
   * de-duped: public supersedes per-target grants, so only one waiver is
   * created for the public target.
   */
  app.put(
    "/skills/:id/permissions",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(permissionsPatchSchema, "INVALID_PERMISSIONS"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByGuid(guid);
      if (!existing) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(existing, actor)) {
        throw AppError.forbidden(
          "FORBIDDEN",
          "You do not have permission to change this skill's visibility",
        );
      }

      const body = getValidatedBody<z.infer<typeof permissionsPatchSchema>>(c);

      const beforePrivate = existing.isPrivate;
      const beforeUsers = new Set(existing.sharedWithUsers);
      const beforeOrgs = new Set(existing.sharedWithOrgs);
      const afterPrivate = body.isPrivate;
      const afterUsers = new Set(body.sharedWithUsers);
      const afterOrgs = new Set(body.sharedWithOrgs);

      const goingPublic = beforePrivate && !afterPrivate;
      const goingPrivate = !beforePrivate && afterPrivate;

      // Public supersedes per-target grants — skip per-user / per-org
      // waivers when flipping public on in the same save.
      const addedUsers = goingPublic
        ? []
        : body.sharedWithUsers.filter((id) => !beforeUsers.has(id));
      const addedOrgs = goingPublic
        ? []
        : body.sharedWithOrgs.filter((id) => !beforeOrgs.has(id));

      const removedUsers = existing.sharedWithUsers.filter((id) => !afterUsers.has(id));
      const removedOrgs = existing.sharedWithOrgs.filter((id) => !afterOrgs.has(id));

      const needsPut =
        removedUsers.length > 0 || removedOrgs.length > 0 || goingPrivate;

      // 1. Removals first. Strip only — adds stay out until audit decides.
      if (needsPut) {
        await skillService.setSkillPermissions(guid, authCtx.userId, {
          isPrivate: goingPrivate ? true : beforePrivate,
          sharedWithUsers: existing.sharedWithUsers.filter(
            (id) => !removedUsers.includes(id),
          ),
          sharedWithOrgs: existing.sharedWithOrgs.filter(
            (id) => !removedOrgs.includes(id),
          ),
        });
      }

      // 2. Additions → audit-gated share requests. Sequential so the
      // per-skill audit cache warms once and subsequent targets reuse.
      const waivers: ShareRequest[] = [];
      const shareTargets: Array<{ type: "user" | "org" | "public"; id?: string }> = [
        ...(goingPublic ? [{ type: "public" as const }] : []),
        ...addedUsers.map((id) => ({ type: "user" as const, id })),
        ...addedOrgs.map((id) => ({ type: "org" as const, id })),
      ];

      for (const target of shareTargets) {
        const result = await shareService.initiateShare({
          skillIdOrName: guid,
          ownerUserId: authCtx.userId,
          target,
        });
        waivers.push(result);
      }

      const updated = await skillService.getSkill(guid);

      activityRepo
        ?.log(authCtx.userId, authCtx.email, authCtx.displayName, "skill:permissions_change", {
          skillId: guid,
          skillName: updated.name,
          isPrivate: updated.isPrivate,
          sharedWithUsers: updated.sharedWithUsers.length,
          sharedWithOrgs: updated.sharedWithOrgs.length,
          waiverCount: waivers.length,
        })
        .catch((err) => logger.warn({ err }, "Failed to log skill:permissions_change activity"));

      return c.json({
        data: {
          skill: updated,
          waivers,
        },
        error: null,
      });
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
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      const skill = await skillRepo.findByGuid(guid);
      if (!skill) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(skill, actor)) {
        throw AppError.forbidden(
          "FORBIDDEN",
          "You do not have permission to delete this skill",
        );
      }
      logger.info({ guid }, "Skill delete via API");
      await skillService.deleteSkill(guid);

      activityRepo?.log(authCtx.userId, authCtx.email, authCtx.displayName, "skill:delete", {
        skillId: guid,
        skillName: skill?.name ?? guid,
      }).catch((err) => logger.warn({ err }, "Failed to log skill:delete activity"));

      return c.json({ data: { success: true }, error: null });
    },
  );

  /**
   * DELETE /skills/:idOrName/versions/:version — Delete one non-latest
   * version of a skill. The skill itself + every other version are
   * preserved. Cannot remove the only remaining version (use
   * DELETE /skills/:id) or the current latest (publish a newer one first).
   * Requires: ornn:skill:delete + owner or admin.
   */
  app.delete(
    "/skills/:idOrName/versions/:version",
    auth,
    requirePermission("ornn:skill:delete"),
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const version = c.req.param("version");
      const authCtx = getAuth(c);

      let skill = await skillRepo.findByGuid(idOrName);
      if (!skill) skill = await skillRepo.findByName(idOrName);
      if (!skill) {
        throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
      }
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };
      if (!canManageSkill(skill, actor)) {
        throw AppError.forbidden(
          "FORBIDDEN",
          "You do not have permission to delete this skill version",
        );
      }
      logger.info(
        { skillGuid: skill.guid, version, userId: authCtx.userId },
        "Skill version delete via API",
      );
      await skillService.deleteVersion(skill.guid, version);

      activityRepo
        ?.log(authCtx.userId, authCtx.email, authCtx.displayName, "skill:version_delete", {
          skillId: skill.guid,
          skillName: skill.name,
          version,
        })
        .catch((err) =>
          logger.warn({ err }, "Failed to log skill:version_delete activity"),
        );

      return c.json({ data: { success: true }, error: null });
    },
  );

  return app;
}
