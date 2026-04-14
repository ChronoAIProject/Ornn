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
import type { SkillRepository } from "../skillCrud/repository";
import type { SkillService } from "../skillCrud/service";
import type { SkillGenerationService } from "../skillGeneration/service";
import type { NyxidServiceClient } from "../../clients/nyxidServiceClient";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
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
  activityRepo: ActivityRepository;
  skillRepo: SkillRepository;
  skillService: SkillService;
  generationService?: SkillGenerationService;
  nyxidServiceClient?: NyxidServiceClient;
}

export function createAdminRoutes(config: AdminRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { adminService, activityRepo, skillRepo, skillService, generationService, nyxidServiceClient } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  // Activity logging endpoint — any authenticated user can log their own login
  app.post("/activity/login", auth, async (c) => {
    const authCtx = getAuth(c);
    const email = c.req.header("X-User-Email") ?? "";
    const displayName = c.req.header("X-User-Display-Name") ?? "";
    await activityRepo.log(authCtx.userId, email, displayName, "login");
    return c.json({ data: { success: true }, error: null });
  });

  app.post("/activity/logout", auth, async (c) => {
    const authCtx = getAuth(c);
    const email = c.req.header("X-User-Email") ?? "";
    const displayName = c.req.header("X-User-Display-Name") ?? "";
    await activityRepo.log(authCtx.userId, email, displayName, "logout");
    return c.json({ data: { success: true }, error: null });
  });

  // All /admin/* routes require auth + admin permission
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

      const email = c.req.header("X-User-Email") ?? "";
      const displayName = c.req.header("X-User-Display-Name") ?? "";
      await activityRepo.log(authCtx.userId, email, displayName, "skill:delete", {
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

  // =========================================================================
  // System Skills — auto-generate skills from NyxID service catalog
  // =========================================================================

  /**
   * GET /admin/system-skills
   * List NyxID services + their skill generation status.
   */
  app.get(
    "/admin/system-skills",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      if (!nyxidServiceClient) {
        throw AppError.serviceUnavailable("NYXID_CLIENT_UNAVAILABLE", "NyxID service client not configured");
      }

      const services = await nyxidServiceClient.listServices();
      const systemSkills = await skillRepo.findSystemSkills();

      const skillMap = new Map(systemSkills.map((s) => [s.nyxidServiceId, s]));

      const items = services.map((svc) => {
        const skill = skillMap.get(svc.id);
        return {
          serviceId: svc.id,
          serviceName: svc.name,
          serviceSlug: svc.slug,
          serviceDescription: svc.description,
          baseUrl: svc.base_url,
          serviceCategory: svc.service_category,
          hasOpenApiSpec: !!svc.openapi_spec_url,
          openApiSpecUrl: svc.openapi_spec_url,
          skillGenerated: !!skill,
          skill: skill ? {
            guid: skill.guid,
            name: skill.name,
            description: skill.description,
            tags: (skill.metadata?.tags as string[]) ?? [],
            createdOn: skill.createdOn instanceof Date ? skill.createdOn.toISOString() : String(skill.createdOn),
            updatedOn: skill.updatedOn instanceof Date ? skill.updatedOn.toISOString() : String(skill.updatedOn),
          } : null,
        };
      });

      return c.json({ data: { items }, error: null });
    },
  );

  /**
   * GET /admin/system-skills (non-admin version for regular users)
   * Regular users can view system skills in the registry.
   */
  app.get(
    "/system-skills",
    async (c) => {
      const systemSkills = await skillRepo.findSystemSkills();
      const items = systemSkills.map((s) => ({
        guid: s.guid,
        name: s.name,
        description: s.description,
        createdBy: s.createdBy,
        createdByEmail: s.createdByEmail,
        createdByDisplayName: s.createdByDisplayName,
        createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
        updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
        isPrivate: false,
        isSystem: true,
        nyxidServiceId: s.nyxidServiceId,
        tags: (s.metadata?.tags as string[]) ?? [],
      }));
      return c.json({
        data: {
          items,
          total: items.length,
          page: 1,
          pageSize: items.length,
          totalPages: 1,
        },
        error: null,
      });
    },
  );

  /**
   * POST /admin/system-skills/:serviceId/generate
   * Fetch OpenAPI spec from NyxID service, generate and store skill.
   */
  app.post(
    "/admin/system-skills/:serviceId/generate",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      if (!nyxidServiceClient || !generationService) {
        throw AppError.serviceUnavailable("SERVICE_UNAVAILABLE", "Generation service or NyxID client not configured");
      }

      const serviceId = c.req.param("serviceId");
      const authCtx = getAuth(c);

      // Check if skill already exists for this service
      const existing = await skillRepo.findByNyxidServiceId(serviceId);
      if (existing) {
        throw AppError.conflict("SYSTEM_SKILL_EXISTS", `System skill already exists for service ${serviceId}. Use regenerate endpoint.`);
      }

      // Fetch service info
      const services = await nyxidServiceClient.listServices();
      const service = services.find((s) => s.id === serviceId);
      if (!service) {
        throw AppError.notFound("SERVICE_NOT_FOUND", `NyxID service ${serviceId} not found`);
      }
      if (!service.openapi_spec_url) {
        throw AppError.badRequest("NO_OPENAPI_SPEC", `Service ${service.name} has no OpenAPI spec URL configured`);
      }

      // Fetch OpenAPI spec
      const specContent = await nyxidServiceClient.fetchOpenApiSpec(service.openapi_spec_url);

      // Generate skill (collect all events, extract the result)
      let generatedRaw = "";
      for await (const event of generationService.generateFromOpenApi(specContent, {
        description: `Skill for ${service.name}: ${service.description ?? ""}`,
      })) {
        if (event.type === "generation_complete") {
          generatedRaw = (event as any).raw ?? "";
        }
        if (event.type === "error") {
          throw AppError.internal(`Skill generation failed: ${(event as any).message}`);
        }
      }

      // Parse the generated skill
      const parsed = generationService.parseAndValidate(generatedRaw);
      if (!parsed) {
        throw AppError.internal("Generated skill failed validation");
      }

      // Build SKILL.md content
      const skillMd = buildSkillMd(parsed);

      // Build ZIP package
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(parsed.name)!;
      folder.file("SKILL.md", skillMd);
      for (const script of parsed.scripts) {
        folder.file(`scripts/${script.filename}`, script.content);
      }
      const zipBuffer = await zip.generateAsync({ type: "uint8array" });

      // Create skill via service (handles storage upload)
      const { guid } = await skillService.createSkill(zipBuffer, authCtx.userId, {
        userEmail: authCtx.email,
        isSystem: true,
        nyxidServiceId: serviceId,
      });

      logger.info({ guid, serviceId, serviceName: service.name }, "System skill generated");

      return c.json({ data: { guid, name: parsed.name, serviceId }, error: null }, 201);
    },
  );

  /**
   * POST /admin/system-skills/:serviceId/regenerate
   * Delete existing system skill and regenerate.
   */
  app.post(
    "/admin/system-skills/:serviceId/regenerate",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      if (!nyxidServiceClient || !generationService) {
        throw AppError.serviceUnavailable("SERVICE_UNAVAILABLE", "Generation service or NyxID client not configured");
      }

      const serviceId = c.req.param("serviceId");
      const authCtx = getAuth(c);

      // Delete existing if present
      const existing = await skillRepo.findByNyxidServiceId(serviceId);
      if (existing) {
        await skillService.deleteSkill(existing.guid);
        logger.info({ guid: existing.guid, serviceId }, "Deleted existing system skill for regeneration");
      }

      // Fetch service info
      const services = await nyxidServiceClient.listServices();
      const service = services.find((s) => s.id === serviceId);
      if (!service) {
        throw AppError.notFound("SERVICE_NOT_FOUND", `NyxID service ${serviceId} not found`);
      }
      if (!service.openapi_spec_url) {
        throw AppError.badRequest("NO_OPENAPI_SPEC", `Service ${service.name} has no OpenAPI spec URL configured`);
      }

      const specContent = await nyxidServiceClient.fetchOpenApiSpec(service.openapi_spec_url);

      let generatedRaw = "";
      for await (const event of generationService.generateFromOpenApi(specContent, {
        description: `Skill for ${service.name}: ${service.description ?? ""}`,
      })) {
        if (event.type === "generation_complete") {
          generatedRaw = (event as any).raw ?? "";
        }
        if (event.type === "error") {
          throw AppError.internal(`Skill generation failed: ${(event as any).message}`);
        }
      }

      const parsed = generationService.parseAndValidate(generatedRaw);
      if (!parsed) {
        throw AppError.internal("Generated skill failed validation");
      }

      const skillMd = buildSkillMd(parsed);
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const folder = zip.folder(parsed.name)!;
      folder.file("SKILL.md", skillMd);
      for (const script of parsed.scripts) {
        folder.file(`scripts/${script.filename}`, script.content);
      }
      const zipBuffer = await zip.generateAsync({ type: "uint8array" });

      const { guid } = await skillService.createSkill(zipBuffer, authCtx.userId, {
        userEmail: authCtx.email,
        isSystem: true,
        nyxidServiceId: serviceId,
      });

      logger.info({ guid, serviceId, serviceName: service.name }, "System skill regenerated");

      return c.json({ data: { guid, name: parsed.name, serviceId }, error: null }, 201);
    },
  );

  /**
   * DELETE /admin/system-skills/:serviceId
   * Delete the system skill for a NyxID service.
   */
  app.delete(
    "/admin/system-skills/:serviceId",
    requirePermission("ornn:admin:skill"),
    async (c) => {
      const serviceId = c.req.param("serviceId");
      const authCtx = getAuth(c);

      const existing = await skillRepo.findByNyxidServiceId(serviceId);
      if (!existing) {
        throw AppError.notFound("SYSTEM_SKILL_NOT_FOUND", `No system skill found for service ${serviceId}`);
      }

      await skillService.deleteSkill(existing.guid);

      const email = c.req.header("X-User-Email") ?? "";
      const displayName = c.req.header("X-User-Display-Name") ?? "";
      await activityRepo.log(authCtx.userId, email, displayName, "skill:delete", {
        skillId: existing.guid,
        systemSkill: true,
        serviceId,
      });

      logger.info({ guid: existing.guid, serviceId, adminUserId: authCtx.userId }, "System skill deleted by admin");
      return c.json({ data: { success: true }, error: null });
    },
  );

  return app;
}

/**
 * Build SKILL.md content from a GeneratedSkill object.
 */
function buildSkillMd(skill: import("../../shared/types/index").GeneratedSkill): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${skill.name}`);
  lines.push(`description: ${skill.description}`);
  lines.push(`metadata:`);
  lines.push(`  category: ${skill.category}`);
  if (skill.outputType) {
    lines.push(`  output-type: ${skill.outputType}`);
  }
  if (skill.runtimes.length > 0) {
    lines.push(`  runtimes:`);
    for (const rt of skill.runtimes) {
      lines.push(`    - runtime: ${rt}`);
      const rtDeps = skill.dependencies.filter(Boolean);
      if (rtDeps.length > 0) {
        lines.push(`      runtime-dependency:`);
        for (const dep of rtDeps) {
          lines.push(`        - ${dep}`);
        }
      }
      const rtEnvs = skill.envVars.filter(Boolean);
      if (rtEnvs.length > 0) {
        lines.push(`      envs:`);
        for (const env of rtEnvs) {
          lines.push(`        - var: ${env}`);
          lines.push(`          description: "${env} environment variable"`);
        }
      }
    }
  }
  if (skill.tags.length > 0) {
    lines.push(`  tags:`);
    for (const tag of skill.tags) {
      lines.push(`    - ${tag}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(skill.readmeBody);
  return lines.join("\n");
}
