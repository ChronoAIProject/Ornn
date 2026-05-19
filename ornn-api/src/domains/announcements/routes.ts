/**
 * Announcement HTTP routes.
 *
 *   GET    /api/v1/announcements                   — public, anonymous (News page list, #357)
 *   GET    /api/v1/announcements/active            — public, anonymous (landing popup)
 *   GET    /api/v1/admin/announcements             — admin list
 *   POST   /api/v1/admin/announcements             — admin create
 *   PATCH  /api/v1/admin/announcements/:id         — admin update
 *   DELETE /api/v1/admin/announcements/:id         — admin delete
 *
 * The public endpoints never see `createdBy` or scheduling internals —
 * they only return the rendering shape the SPA needs (popup + News
 * page archive).
 *
 * Content is bilingual (en + zh). The wire format flattens locales as
 * `titleEn` / `titleZh` etc. EN fields are required; ZH fields are
 * optional (default empty string for body/title, null for CTA label).
 * Frontend resolves at render time, falling back to EN whenever the
 * active locale's slot is empty.
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

const requiredString = (max: number) => z.string().trim().min(1).max(max);
/** Optional locale slot — empty string when unset. */
const optionalLocaleString = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v ?? "").trim());

const ctaLabelOptional = z
  .union([z.string().trim().min(1).max(80), z.null()])
  .optional();

const createSchema = z
  .object({
    titleEn: requiredString(200),
    titleZh: optionalLocaleString(200),
    bodyMarkdownEn: requiredString(20_000),
    bodyMarkdownZh: optionalLocaleString(20_000),
    ctaLabelEn: ctaLabelOptional,
    ctaLabelZh: ctaLabelOptional,
    ctaUrl: z.union([z.string().trim().url().max(2048), z.null()]).optional(),
    enabled: z.boolean(),
    startsAt: isoDateNullable.optional(),
    endsAt: isoDateNullable.optional(),
  })
  .superRefine(assertCtaPairing);

const updateSchema = z
  .object({
    titleEn: requiredString(200).optional(),
    titleZh: optionalLocaleString(200).optional(),
    bodyMarkdownEn: requiredString(20_000).optional(),
    bodyMarkdownZh: optionalLocaleString(20_000).optional(),
    ctaLabelEn: ctaLabelOptional,
    ctaLabelZh: ctaLabelOptional,
    ctaUrl: z.union([z.string().trim().url().max(2048), z.null()]).optional(),
    enabled: z.boolean().optional(),
    startsAt: isoDateNullable.optional(),
    endsAt: isoDateNullable.optional(),
  })
  .superRefine(assertCtaPairing);

/**
 * "Both-or-neither" rule for the CTA pair on the EN side. `ctaUrl`
 * either is set with a non-null `ctaLabelEn`, or both are null/absent.
 * `ctaLabelZh` is independent (optional translation of the label —
 * frontend falls back to `ctaLabelEn` when empty).
 */
function assertCtaPairing(
  value: {
    ctaUrl?: string | null;
    ctaLabelEn?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  const hasUrl = typeof value.ctaUrl === "string" && value.ctaUrl.length > 0;
  const hasEnLabel =
    typeof value.ctaLabelEn === "string" && value.ctaLabelEn.length > 0;
  if (hasUrl !== hasEnLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasUrl ? "ctaLabelEn" : "ctaUrl"],
      message: "ctaLabelEn and ctaUrl must both be set, or both null",
    });
  }
}

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
  app.get("/announcements", async (c) => {
    const items = await announcementService.listPublished();
    return c.json({ data: { items }, error: null });
  });

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
      titleEn: parsed.data.titleEn,
      titleZh: parsed.data.titleZh,
      bodyMarkdownEn: parsed.data.bodyMarkdownEn,
      bodyMarkdownZh: parsed.data.bodyMarkdownZh,
      ctaLabelEn: parsed.data.ctaLabelEn ?? null,
      ctaLabelZh: parsed.data.ctaLabelZh ?? null,
      ctaUrl: parsed.data.ctaUrl ?? null,
      enabled: parsed.data.enabled,
      startsAt: parsed.data.startsAt ?? null,
      endsAt: parsed.data.endsAt ?? null,
      createdBy: authCtx.userId,
    });
    // 201 already set; add Location to match CONVENTIONS.md §3.2 (#458).
    c.header("Location", `/api/v1/admin/announcements/${created._id}`);
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
  titleEn: string;
  titleZh: string;
  bodyMarkdownEn: string;
  bodyMarkdownZh: string;
  ctaLabelEn: string | null;
  ctaLabelZh: string | null;
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
    titleEn: doc.titleEn,
    titleZh: doc.titleZh,
    bodyMarkdownEn: doc.bodyMarkdownEn,
    bodyMarkdownZh: doc.bodyMarkdownZh,
    ctaLabelEn: doc.ctaLabelEn,
    ctaLabelZh: doc.ctaLabelZh,
    ctaUrl: doc.ctaUrl,
    enabled: doc.enabled,
    startsAt: doc.startsAt ? doc.startsAt.toISOString() : null,
    endsAt: doc.endsAt ? doc.endsAt.toISOString() : null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
