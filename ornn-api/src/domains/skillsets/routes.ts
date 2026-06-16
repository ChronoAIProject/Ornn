/**
 * Skillset CRUD + closure routes (#969).
 *
 * URL layout follows CONVENTIONS.md (plural noun). Static sub-resource
 * segments (`/closure`, `/versions`) are registered ABOVE the
 * `/:idOrName` capture so the literal segment wins the match (mirrors the
 * skills `/closure` registration order).
 *
 * Permission scopes REUSE the existing `ornn:skill:{create,read,update,
 * delete}` scopes — a skillset is a skill-lifecycle resource. A dedicated
 * `ornn:skillset:*` scope split is a tracked follow-up (see
 * docs/CONVENTIONS.md).
 *
 *   POST   /skillsets                       — create (ornn:skill:create)
 *   GET    /skillsets/:idOrName/closure     — resolve (optional auth)
 *   GET    /skillsets/:idOrName/versions    — list   (optional auth)
 *   GET    /skillsets/:idOrName             — read   (optional auth)
 *   PUT    /skillsets/:id                   — publish (ornn:skill:update)
 *   PUT    /skillsets/:id/permissions       — visibility (ornn:skill:update)
 *   DELETE /skillsets/:id                   — delete (ornn:skill:delete)
 *
 * @module domains/skillsets/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { buildActorContext, type ActorContext } from "../skills/crud/authorize";
import { createLogger } from "../../shared/logger";
import type { SkillsetService } from "./service";
import {
  createSkillsetSchema,
  publishSkillsetSchema,
  skillsetPermissionsSchema,
} from "./types";

const logger = createLogger("skillsetRoutes");

export interface SkillsetRoutesConfig {
  skillsetService: SkillsetService;
}

/** Body for `POST /skillsets/:id/transfer-ownership` (#1123). */
const transferOwnershipSchema = z.object({
  newOwnerUserId: z.string().min(1).max(128),
});

/** Anonymous read actor — sees public skillsets only. Fresh per call so
 * the mutable `memberships` array is never shared. */
function anonActor(): ActorContext {
  return {
    userId: "",
    memberships: [],
    isPlatformAdmin: false,
    membershipsResolved: true,
  };
}

export function createSkillsetRoutes(
  config: SkillsetRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { skillsetService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * POST /skillsets — create a skillset (private by default).
   * Requires: ornn:skill:create
   */
  app.post(
    "/skillsets",
    auth,
    requirePermission("ornn:skill:create"),
    validateBody(createSkillsetSchema, "invalid_skillset"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<z.infer<typeof createSkillsetSchema>>(c);
      const created = await skillsetService.createSkillset(body, {
        userId: authCtx.userId,
        email: authCtx.email,
        displayName: authCtx.displayName,
      });
      logger.info({ guid: created.guid, name: created.name }, "Skillset created via API");
      c.header("Location", `/api/v1/skillsets/${created.guid}`);
      return c.json({ data: created, error: null }, 201);
    },
  );

  /**
   * GET /skillsets/:idOrName/closure — one-call resolve: union of all
   * members + each member's #968 dependency closure, deduped + topo-sorted.
   *
   * Registered ABOVE /skillsets/:idOrName so the literal `/closure`
   * segment wins. Auth: optional — anon callers resolve public skillsets
   * only; a private member dep surfaces as skill_dependency_not_found.
   */
  app.get("/skillsets/:idOrName/closure", optionalAuth, async (c) => {
    const idOrName = c.req.param("idOrName");
    const version = c.req.query("version") || undefined;
    const authCtx = c.get("auth");
    const actor = authCtx ? await buildActorContext(c) : anonActor();
    logger.info(
      { idOrName, version: version ?? null, anon: !authCtx },
      "Skillset closure request",
    );
    // `instructions` (the master prompt, #978) is a ROOT sibling of `items`
    // — sourced from the same loaded version the resolver read.
    const { instructions, items } = await skillsetService.resolveClosure(idOrName, actor, version);
    return c.json({ data: { instructions, items }, error: null });
  });

  /**
   * GET /skillsets/:idOrName/versions — list all published versions,
   * newest first. Visibility matches GET /skillsets/:idOrName.
   */
  app.get("/skillsets/:idOrName/versions", optionalAuth, async (c) => {
    const idOrName = c.req.param("idOrName");
    const authCtx = c.get("auth");
    const actor = authCtx ? await buildActorContext(c) : anonActor();
    // Member-derived read gate (#1136) on the latest version — throws a flat
    // 404 if the caller can't read every member (no leak), identical to a
    // missing skillset. Owner/admin always pass.
    await skillsetService.getSkillsetForRead(idOrName, actor);
    const items = await skillsetService.listVersions(idOrName);
    return c.json({ data: { items }, error: null });
  });

  /**
   * GET /skillsets/:idOrName — read a skillset by GUID or name.
   * Query: `version` (optional). Auth: optional — anon sees public only.
   */
  app.get("/skillsets/:idOrName", optionalAuth, async (c) => {
    const idOrName = c.req.param("idOrName");
    const version = c.req.query("version") || undefined;
    const authCtx = c.get("auth");
    const actor = authCtx ? await buildActorContext(c) : anonActor();
    // Member-derived read gate (#1136): readable iff the caller can read
    // every member. Owner/admin always see it (with `unreadableMembers`
    // listed for repair); everyone else 404s the moment a member is
    // unreadable — no leak of which member is private.
    const detail = await skillsetService.getSkillsetForRead(idOrName, actor, version);
    return c.json({ data: detail, error: null });
  });

  /**
   * PUT /skillsets/:id — publish a new immutable version.
   * Requires: ornn:skill:update + author/admin.
   */
  app.put(
    "/skillsets/:id",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(publishSkillsetSchema, "invalid_skillset"),
    async (c) => {
      const id = c.req.param("id");
      const body = getValidatedBody<z.infer<typeof publishSkillsetSchema>>(c);
      const actor = await buildActorContext(c);
      const updated = await skillsetService.publishVersion(id, body, actor);
      logger.info({ guid: id, version: updated.version }, "Skillset version published via API");
      return c.json({ data: updated, error: null });
    },
  );

  /**
   * PUT /skillsets/:id/permissions — apply a new ACL state.
   * Requires: ornn:skill:update + author/admin.
   */
  app.put(
    "/skillsets/:id/permissions",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(skillsetPermissionsSchema, "invalid_permissions"),
    async (c) => {
      const id = c.req.param("id");
      const body = getValidatedBody<z.infer<typeof skillsetPermissionsSchema>>(c);
      const actor = await buildActorContext(c);
      const updated = await skillsetService.setPermissions(
        id,
        {
          isPrivate: body.isPrivate,
          grants: body.grants,
          sharedWithUsers: body.sharedWithUsers,
          sharedWithOrgs: body.sharedWithOrgs,
        },
        actor,
      );
      return c.json({ data: { skillset: updated }, error: null });
    },
  );

  /**
   * DELETE /skillsets/:id — delete a skillset + all its versions.
   * Requires: ornn:skill:delete + author/admin.
   */
  app.delete(
    "/skillsets/:id",
    auth,
    requirePermission("ornn:skill:delete"),
    async (c) => {
      const id = c.req.param("id");
      const actor = await buildActorContext(c);
      await skillsetService.deleteSkillset(id, actor);
      return c.json({ data: { success: true }, error: null });
    },
  );

  /**
   * POST /skillsets/:id/transfer-ownership — hand the skillset to another
   * Ornn user (#1123). ADMIN-tier; immediate; prior owner kept as READ.
   * Mirrors the skills endpoint.
   */
  app.post(
    "/skillsets/:id/transfer-ownership",
    auth,
    requirePermission("ornn:skill:update"),
    validateBody(transferOwnershipSchema, "invalid_transfer"),
    async (c) => {
      const id = c.req.param("id");
      const body = getValidatedBody<z.infer<typeof transferOwnershipSchema>>(c);
      const actor = await buildActorContext(c);
      // The service owns the full flow (ADMIN gate + target validation +
      // mutation) so a non-owner can't enumerate users via the response.
      const updated = await skillsetService.transferOwnership(id, body.newOwnerUserId, actor);
      logger.info({ guid: id, newOwnerId: body.newOwnerUserId }, "Skillset ownership transferred via API");
      return c.json({ data: { skillset: updated }, error: null });
    },
  );

  return app;
}
