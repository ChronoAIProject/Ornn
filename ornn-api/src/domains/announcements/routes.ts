/**
 * Announcement HTTP routes.
 *
 *   GET    /api/v1/announcements/active            — public, anonymous
 *   GET    /api/v1/admin/announcements             — admin list
 *   POST   /api/v1/admin/announcements             — admin create
 *   PATCH  /api/v1/admin/announcements/:id         — admin update
 *   DELETE /api/v1/admin/announcements/:id         — admin delete
 *
 * The public endpoint never sees `createdBy` or scheduling internals — it
 * only returns the rendering shape used by the landing-page popup.
 *
 * @module domains/announcements/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import type { AnnouncementService } from "./service";
import type { AnnouncementDocument } from "./types";

const ADMIN_PERMISSION = "ornn:admin:skill";

const isoDateNullable = z
  .union([z.string().datetime({ offset: true }), z.null()])
  .transform((v) => (v === null ? null : new Date(v)));

const optionalString = (max: number) => z.string().trim().min(1).max(max);

const createSchema = z.object({
  title: optionalString(200),
  bodyMarkdown: z.string().min(1).max(20_000),
  ctaLabel: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
  ctaUrl: z.union([z.string().trim().url().max(2048), z.null()]).optional(),
  enabled: z.boolean(),
  startsAt: isoDateNullable.optional(),
  endsAt: isoDateNullable.optional(),
});

const updateSchema = z.object({
  title: optionalString(200).optional(),
  bodyMarkdown: z.string().min(1).max(20_000).optional(),
  ctaLabel: z.union([z.string().trim().min(1).max(80), z.null()]).optional(),
  ctaUrl: z.union([z.string().trim().url().max(2048), z.null()]).optional(),
  enabled: z.boolean().optional(),
  startsAt: isoDateNullable.optional(),
  endsAt: isoDateNullable.optional(),
});

export interface AnnouncementRoutesConfig {
  readonly announcementService: AnnouncementService;
}

export function createAnnouncementRoutes(
  config: AnnouncementRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { announcementService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();
  const adminGuard = requirePermission(ADMIN_PERMISSION);

  // ---- Public ----
  app.get("/announcements/active", async (c) => {
    const active = await announcementService.getActive();
    return c.json({ data: { active }, error: null });
  });

  // ---- Admin ----
  app.get("/admin/announcements", auth, adminGuard, async (c) => {
    const items = await announcementService.listAll();
    return c.json({ data: { items: items.map(toAdminDto) }, error: null });
  });

  app.post("/admin/announcements", auth, adminGuard, async (c) => {
    const authCtx = getAuth(c);
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest(
        "INVALID_ANNOUNCEMENT_INPUT",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    const created = await announcementService.create({
      title: parsed.data.title,
      bodyMarkdown: parsed.data.bodyMarkdown,
      ctaLabel: parsed.data.ctaLabel ?? null,
      ctaUrl: parsed.data.ctaUrl ?? null,
      enabled: parsed.data.enabled,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      createdBy: authCtx.userId,
    });
    return c.json({ data: toAdminDto(created), error: null }, 201);
  });

  app.patch("/admin/announcements/:id", auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.badRequest(
        "INVALID_ANNOUNCEMENT_INPUT",
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    if (Object.keys(parsed.data).length === 0) {
      throw AppError.badRequest("INVALID_ANNOUNCEMENT_INPUT", "No fields to update");
    }
    const updated = await announcementService.update(id, parsed.data);
    return c.json({ data: toAdminDto(updated), error: null });
  });

  app.delete("/admin/announcements/:id", auth, adminGuard, async (c) => {
    const id = c.req.param("id");
    await announcementService.delete(id);
    return c.json({ data: { id }, error: null });
  });

  return app;
}

interface AdminAnnouncementDto {
  id: string;
  title: string;
  bodyMarkdown: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function toAdminDto(doc: AnnouncementDocument): AdminAnnouncementDto {
  return {
    id: doc._id,
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    ctaLabel: doc.ctaLabel,
    ctaUrl: doc.ctaUrl,
    enabled: doc.enabled,
    startsAt: doc.startsAt ? doc.startsAt.toISOString() : null,
    endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
