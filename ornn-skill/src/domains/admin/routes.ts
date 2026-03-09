/**
 * Admin routes with NyxID auth.
 * Category and Tag CRUD. Requires ornn:admin:category / ornn:admin:skill permissions.
 * User management removed (now in NyxID).
 * @module domains/admin/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AdminService } from "./service";
import {
  type AuthVariables,
  type NyxIDAuthConfig,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
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
  authConfig: NyxIDAuthConfig;
}

export function createAdminRoutes(config: AdminRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { adminService, authConfig } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware(authConfig);
  app.use("/admin/*", auth);

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
    async (c) => {
      const body = await c.req.json();
      const parsed = createCategorySchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const category = await adminService.createCategory(parsed.data);
      logger.info({ name: parsed.data.name }, "Category created via admin API");
      return c.json({ data: category, error: null }, 201);
    },
  );

  app.put(
    "/admin/categories/:id",
    requirePermission("ornn:admin:category"),
    async (c) => {
      const id = c.req.param("id");
      const body = await c.req.json();
      const parsed = updateCategorySchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const category = await adminService.updateCategory(id, parsed.data);
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
    async (c) => {
      const body = await c.req.json();
      const parsed = createTagSchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      const tag = await adminService.createTag(parsed.data.name);
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
