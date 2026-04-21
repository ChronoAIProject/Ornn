/**
 * HTTP routes for the Topics domain.
 *
 * All mutation endpoints are gated by existing permission strings
 * (`ornn:skill:create/update/delete`) to avoid inventing new permissions
 * for MVP. Per-topic ownership (author / org admin / platform admin) is
 * enforced in the service layer via `canManageTopic`, which the routes
 * delegate to by calling the service's write-path methods directly.
 *
 * @module domains/topics/routes
 */

import { Hono } from "hono";
import type { TopicService } from "./service";
import type { TopicRepository } from "./repository";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  optionalAuthMiddleware,
  requirePermission,
  getAuth,
  readUserOrgMemberships,
  readUserOrgIds,
} from "../../middleware/nyxidAuth";
import { isMemberOfOrg } from "../skillCrud/authorize";
import { AppError } from "../../shared/types/index";
import {
  topicCreateSchema,
  topicUpdateSchema,
  topicAddSkillsSchema,
} from "./schemas";
import { z } from "zod";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "topicsRoutes" });

const listQuerySchema = z.object({
  query: z.string().max(2000).optional().default(""),
  scope: z.enum(["public", "mine", "mixed"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export interface TopicRoutesConfig {
  topicService: TopicService;
  /**
   * Kept for parity with the skills routes config. Unused here — the service
   * owns all per-topic lookups now that write gates live server-side.
   */
  topicRepo?: TopicRepository;
}

export function createTopicRoutes(config: TopicRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { topicService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();
  const optionalAuth = optionalAuthMiddleware();

  /**
   * POST /topics — Create a new topic.
   */
  app.post(
    "/topics",
    auth,
    requirePermission("ornn:skill:create"),
    async (c) => {
      const authCtx = getAuth(c);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw AppError.badRequest("INVALID_BODY", "Request body must be valid JSON");
      }
      const parsed = topicCreateSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_TOPIC",
          parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
        );
      }

      const userEmail = authCtx.email || undefined;
      const userDisplayName = authCtx.displayName || undefined;

      // Verify org membership when the caller is trying to create a topic
      // under a non-self owner. Fail-closed: 403 if we can't prove membership.
      const targetOrgId = parsed.data.targetOrgId;
      if (targetOrgId) {
        const memberships = await readUserOrgMemberships(c);
        const actor = {
          userId: authCtx.userId,
          memberships,
          isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        };
        if (!isMemberOfOrg(actor, targetOrgId) && !actor.isPlatformAdmin) {
          throw AppError.forbidden(
            "NOT_ORG_MEMBER",
            `You are not an admin or member of org '${targetOrgId}'`,
          );
        }
      }

      const topic = await topicService.createTopic(
        {
          name: parsed.data.name,
          description: parsed.data.description,
          isPrivate: parsed.data.isPrivate,
          targetOrgId,
        },
        {
          userId: authCtx.userId,
          userEmail,
          userDisplayName,
        },
      );
      logger.info({ guid: topic.guid, name: topic.name, userId: authCtx.userId, targetOrgId }, "Topic created via API");
      return c.json({ data: topic, error: null });
    },
  );

  /**
   * GET /topics — List topics. Anonymous users are pinned to `public`
   * scope regardless of the requested value.
   */
  app.get(
    "/topics",
    optionalAuth,
    async (c) => {
      const raw = {
        query: c.req.query("query"),
        scope: c.req.query("scope"),
        page: c.req.query("page"),
        pageSize: c.req.query("pageSize"),
      };
      const parsed = listQuerySchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_QUERY",
          parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
        );
      }

      const authCtx = c.get("auth");
      const isAnonymous = !authCtx;
      const scope = isAnonymous ? "public" : parsed.data.scope ?? "mixed";
      const currentUserId = authCtx?.userId ?? "";
      // Anonymous viewers never see private/org-owned topics, so we can skip
      // the org lookup entirely. For signed-in users we always resolve the
      // memberships (lazy + memoized) so both `mine` and `mixed` scopes can
      // expand into the user's org-owned topics.
      const userOrgIds = authCtx ? await readUserOrgIds(c) : [];

      const response = await topicService.listTopics({
        query: parsed.data.query,
        scope,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        currentUserId,
        userOrgIds,
      });
      return c.json({ data: response, error: null });
    },
  );

  /**
   * GET /topics/:idOrName — Read topic + its visible skills.
   */
  app.get(
    "/topics/:idOrName",
    optionalAuth,
    async (c) => {
      const idOrName = c.req.param("idOrName");
      const authCtx = c.get("auth");
      const currentUserId = authCtx?.userId ?? "";
      const isAdmin = authCtx?.permissions.includes("ornn:admin:skill") ?? false;
      // Anonymous readers have no org memberships. Signed-in readers resolve
      // memberships via the request-scoped memoized getter so the lookup
      // happens at most once per request.
      const memberships = authCtx ? await readUserOrgMemberships(c) : [];

      const detail = await topicService.getTopic(idOrName, {
        currentUserId,
        isAdmin,
        memberships,
      });
      return c.json({ data: detail, error: null });
    },
  );

  /**
   * PUT /topics/:id — Update description / isPrivate. Name is immutable.
   */
  app.put(
    "/topics/:id",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const id = c.req.param("id");
      const authCtx = getAuth(c);
      const memberships = await readUserOrgMemberships(c);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw AppError.badRequest("INVALID_BODY", "Request body must be valid JSON");
      }
      const parsed = topicUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_TOPIC_UPDATE",
          parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
        );
      }

      const updated = await topicService.updateTopic(id, parsed.data, {
        currentUserId: authCtx.userId,
        isAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        memberships,
      });
      return c.json({ data: updated, error: null });
    },
  );

  /**
   * DELETE /topics/:id — Hard-delete + cascade membership.
   */
  app.delete(
    "/topics/:id",
    auth,
    requirePermission("ornn:skill:delete"),
    async (c) => {
      const id = c.req.param("id");
      const authCtx = getAuth(c);
      const memberships = await readUserOrgMemberships(c);
      await topicService.deleteTopic(id, {
        currentUserId: authCtx.userId,
        isAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        memberships,
      });
      return c.json({ data: { success: true }, error: null });
    },
  );

  /**
   * POST /topics/:id/skills — Add one or more skills to a topic.
   * Body: `{ skillIds: string[] }` — GUIDs or names are both accepted.
   */
  app.post(
    "/topics/:id/skills",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const id = c.req.param("id");
      const authCtx = getAuth(c);
      const memberships = await readUserOrgMemberships(c);

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw AppError.badRequest("INVALID_BODY", "Request body must be valid JSON");
      }
      const parsed = topicAddSkillsSchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          "INVALID_ADD_SKILLS",
          parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
        );
      }

      const result = await topicService.addSkills(id, parsed.data.skillIds, {
        currentUserId: authCtx.userId,
        isAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        memberships,
      });
      return c.json({ data: result, error: null });
    },
  );

  /**
   * DELETE /topics/:id/skills/:skillGuid — Remove a single skill from a
   * topic. 404 if the edge doesn't exist.
   */
  app.delete(
    "/topics/:id/skills/:skillGuid",
    auth,
    requirePermission("ornn:skill:update"),
    async (c) => {
      const id = c.req.param("id");
      const skillGuid = c.req.param("skillGuid");
      const authCtx = getAuth(c);
      const memberships = await readUserOrgMemberships(c);
      const result = await topicService.removeSkill(id, skillGuid, {
        currentUserId: authCtx.userId,
        isAdmin: authCtx.permissions.includes("ornn:admin:skill"),
        memberships,
      });
      return c.json({ data: result, error: null });
    },
  );

  return app;
}
