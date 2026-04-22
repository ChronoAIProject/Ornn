/**
 * Admin routes with NyxID auth.
 * Category/Tag CRUD, activity log, user dashboard, skill management.
 * Requires ornn:admin:* permissions.
 * @module domains/admin/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AdminService } from "./service";
import type { ActivityRepository, ActivityAction } from "./activityRepository";
import type { SkillRepository } from "../skills/crud/repository";
import type { SkillService } from "../skills/crud/service";
import type { SkillGenerationService } from "../skills/generation/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "adminRoutes" });

const createCategorySchema = z.object({
  name: z.enum(["plain", "tool-based", "runtime-based", "mixed"]),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  description: z.string().min(1).max(500),
  order: z.number().int().min(0).optional(),
});

const updateCategorySchema = z.object({
  description: z.string().min(1).max(500).optional(),
  order: z.number().int().min(0).optional(),
});

const createTagSchema = z.object({
  name: z.string().min(1).max(30).regex(/^[a-z0-9-_]+$/, "Tag name must be lowercase alphanumeric with hyphens/underscores"),
});

export interface AdminRoutesConfig {
  adminService: AdminService;
  activityRepo: ActivityRepository;
  skillRepo: SkillRepository;
  skillService: SkillService;
  /**
   * Legacy injection slot — retained so the bootstrap wiring doesn't need
   * to change if admin system-skill endpoints are re-added later in a
   * tag-based form. Currently unused.
   */
  generationService?: SkillGenerationService;
  nyxidTokenUrl?: string;
}

export function createAdminRoutes(config: AdminRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { adminService, activityRepo, skillRepo, skillService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  // All /admin/* routes require auth + admin permission.
  // `/activity/login` and `/activity/logout` now live under the `me`
  // domain — this is a caller-scoped telemetry event, not an admin
  // operation.
  app.use("/admin/*", auth);

  // =========================================================================
  // Dashboard Stats
  // =========================================================================

  app.get(
    "/admin/stats",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const skillCollection = skillRepo["collection"];
      const stats = await activityRepo.getStats(skillCollection);
      return c.json({ data: stats, error: null });
    },
  );

  // =========================================================================
  // Activity Log
  // =========================================================================

  app.get(
    "/admin/activities",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const action = c.req.query("action") as ActivityAction | undefined;
      const userId = c.req.query("userId") || undefined;

      const result = await activityRepo.list({ page, pageSize, action, userId });
      const totalPages = Math.ceil(result.total / pageSize);

      return c.json({
        data: {
          items: result.items.map((a) => ({
            id: a._id,
            userId: a.userId,
            userEmail: a.userEmail,
            userDisplayName: a.userDisplayName,
            action: a.action,
            details: a.details,
            createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
          })),
          total: result.total,
          page,
          pageSize,
          totalPages,
        },
        error: null,
      });
    },
  );

  // =========================================================================
  // User Dashboard
  // =========================================================================

  app.get(
    "/admin/users",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));

      const skillCollection = skillRepo["collection"];
      const result = await activityRepo.aggregateUsers(skillCollection, page, pageSize);
      const totalPages = Math.ceil(result.total / pageSize);

      return c.json({
        data: {
          items: result.items,
          total: result.total,
          page,
          pageSize,
          totalPages,
        },
        error: null,
      });
    },
  );

  // =========================================================================
  // Admin Skill Management — browse ALL skills, CRUD any skill
  // =========================================================================

  app.get(
    "/admin/skills",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const q = c.req.query("q") || "";
      const userId = c.req.query("userId") || undefined;

      // Admin can see all skills — no scope filtering
      const filter: Record<string, unknown> = {};
      if (userId) filter.createdBy = userId;

      const skillCollection = skillRepo["collection"];

      if (q) {
        const regex = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        filter.$or = [
          { name: { $regex: regex, $options: "i" } },
          { description: { $regex: regex, $options: "i" } },
        ];
      }

      const total = await skillCollection.countDocuments(filter);
      const offset = (page - 1) * pageSize;
      const docs = await skillCollection
        .find(filter)
        .sort({ createdOn: -1 })
        .skip(offset)
        .limit(pageSize)
        .toArray();

      const items = docs.map((d) => ({
        guid: d._id as string,
        name: d.name as string,
        description: d.description as string,
        createdBy: (d.createdBy as string) ?? "",
        createdByEmail: (d.createdByEmail as string) ?? "",
        createdByDisplayName: (d.createdByDisplayName as string) ?? "",
        createdOn: d.createdOn instanceof Date ? d.createdOn.toISOString() : String(d.createdOn),
        updatedOn: d.updatedOn instanceof Date ? d.updatedOn.toISOString() : String(d.updatedOn),
        isPrivate: (d.isPrivate as boolean) ?? true,
        tags: ((d.metadata as Record<string, unknown>)?.tags as string[]) ?? [],
      }));

      return c.json({
        data: {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
        error: null,
      });
    },
  );

  app.delete(
    "/admin/skills/:id",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const guid = c.req.param("id");
      const authCtx = getAuth(c);
      await skillService.deleteSkill(guid);

      await activityRepo.log(authCtx.userId, authCtx.email, authCtx.displayName, "skill:delete", {
        skillId: guid,
        adminAction: true,
      });

      logger.info({ guid, adminUserId: authCtx.userId }, "Skill deleted by admin");
      return c.json({ data: { success: true }, error: null });
    },
  );

  // =========================================================================
  // Category Management (ornn:admin:category)
  // =========================================================================

  app.get(
    "/admin/categories",
    requirePermission("ornn:admin:category"),
    async (c) => {
      const categories = await adminService.listCategories();
      return c.json({ data: categories, error: null });
    },
  );

  app.post(
    "/admin/categories",
    requirePermission("ornn:admin:category"),
    validateBody(createCategorySchema, "VALIDATION_ERROR"),
    async (c) => {
      const body = getValidatedBody<z.infer<typeof createCategorySchema>>(c);
      const category = await adminService.createCategory(body);
      logger.info({ name: body.name }, "Category created via admin API");
      return c.json({ data: category, error: null }, 201);
    },
  );

  app.put(
    "/admin/categories/:id",
    requirePermission("ornn:admin:category"),
    validateBody(updateCategorySchema, "VALIDATION_ERROR"),
    async (c) => {
      const id = c.req.param("id");
      const body = getValidatedBody<z.infer<typeof updateCategorySchema>>(c);
      const category = await adminService.updateCategory(id, body);
      return c.json({ data: category, error: null });
    },
  );

  app.delete(
    "/admin/categories/:id",
    requirePermission("ornn:admin:category"),
    async (c) => {
      const id = c.req.param("id");
      await adminService.deleteCategory(id);
      return c.json({ data: { success: true }, error: null });
    },
  );

  // =========================================================================
  // Tag Management (ornn:admin:skill)
  // =========================================================================

  app.get(
    "/admin/tags",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const type = c.req.query("type") as "predefined" | "custom" | undefined;
      const tags = await adminService.listTags(type);
      return c.json({ data: tags, error: null });
    },
  );

  app.post(
    "/admin/tags",
    requirePermission("ornn:admin:skill"),
    validateBody(createTagSchema, "VALIDATION_ERROR"),
    async (c) => {
      const body = getValidatedBody<z.infer<typeof createTagSchema>>(c);
      const tag = await adminService.createTag(body.name);
      return c.json({ data: tag, error: null }, 201);
    },
  );

  app.delete(
    "/admin/tags/:id",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const id = c.req.param("id");
      await adminService.deleteTag(id);
      return c.json({ data: { success: true }, error: null });
    },
  );


  return app;
}

