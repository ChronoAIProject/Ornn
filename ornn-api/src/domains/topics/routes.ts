/**
 * HTTP routes for the Topics domain.
 *
 * All mutation endpoints are gated by existing permission strings
 * (`ornn:skill:create/update/delete`) to avoid inventing new permissions for
 * MVP. Ownership is enforced per-topic by the service's
 * `resolveTopicForManagement` which is in turn called by the
 * `requireOwnerOrAdmin` middleware via a closure that looks up the topic's
 * `createdBy` field.
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
  requireOwnerOrAdmin,
  getAuth,
} from "../../middleware/nyxidAuth";
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
  topicRepo: TopicRepository;
}

export function createTopicRoutes(config: TopicRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { topicService, topicRepo } = config;
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

      const userEmail = c.req.header("X-User-Email") || undefined;
      const userDisplayName = c.req.header("X-User-Display-Name") || undefined;

      const topic = await topicService.createTopic(parsed.data, {
        userId: authCtx.userId,
        userEmail,
        userDisplayName,
      });
      logger.info({ guid: topic.guid, name: topic.name, userId: authCtx.userId }, "Topic created via API");
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

      const response = await topicService.listTopics({
        query: parsed.data.query,
        scope,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        currentUserId,
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

      const detail = await topicService.getTopic(idOrName, { currentUserId, isAdmin });
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
    requireOwnerOrAdmin(async (c) => {
      const id = c.req.param("id");
      const topic = await topicRepo.findByGuid(id);
      return topic?.createdBy ?? "";
    }),
    async (c) => {
      const id = c.req.param("id");
      const authCtx = getAuth(c);

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

      const updated = await topicService.updateTopic(id, parsed.data, authCtx.userId);
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
    requireOwnerOrAdmin(async (c) => {
      const id = c.req.param("id");
      const topic = await topicRepo.findByGuid(id);
      return topic?.createdBy ?? "";
    }),
    async (c) => {
      const id = c.req.param("id");
      await topicService.deleteTopic(id);
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
    requireOwnerOrAdmin(async (c) => {
      const id = c.req.param("id");
      const topic = await topicRepo.findByGuid(id);
      return topic?.createdBy ?? "";
    }),
    async (c) => {
      const id = c.req.param("id");
      const authCtx = getAuth(c);
      const isAdmin = authCtx.permissions.includes("ornn:admin:skill");

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
        isAdmin,
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
    requireOwnerOrAdmin(async (c) => {
      const id = c.req.param("id");
      const topic = await topicRepo.findByGuid(id);
      return topic?.createdBy ?? "";
    }),
    async (c) => {
      const id = c.req.param("id");
      const skillGuid = c.req.param("skillGuid");
      const result = await topicService.removeSkill(id, skillGuid);
      return c.json({ data: result, error: null });
    },
  );

  return app;
}
