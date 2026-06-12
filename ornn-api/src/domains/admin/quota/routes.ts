/**
 * Admin quota HTTP surface (calendar-month bucket model).
 *
 *   /api/v1/admin/quota/users                — per-user current-month rows.
 *   /api/v1/admin/quota/users/:id/lifetime   — monthly history.
 *   /api/v1/admin/quota/grant                — single grant (no periodMonths).
 *   /api/v1/admin/quota/grant/bulk           — bulk grant.
 *   /api/v1/admin/quota/grants               — paginated audit trail.
 *
 * All gated on `ornn:admin:skill`. Admin users themselves are excluded
 * from `/admin/quota/users` (they bypass quota).
 *
 * @module domains/admin/quota/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import { createLogger } from "../../../shared/logger";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { AppError } from "../../../shared/types/index";
import { MAX_PAGE } from "../../../shared/cursor";
import type { UserDirectoryRepository } from "../../users/repository";
import type { QuotaService } from "../../quota/service";
import {
  QUOTA_ADMIN_PERMISSION,
  SURFACES,
  monthBounds,
} from "../../quota/types";

const logger = createLogger("adminQuotaRoutes");

const surfaceSchema = z.enum(SURFACES);

const grantSchema = z.object({
  userId: z.string().min(1),
  surface: surfaceSchema,
  amount: z.number().int().positive().max(100_000),
  note: z.string().max(500).optional(),
});

const bulkGrantSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  surface: surfaceSchema,
  amount: z.number().int().positive().max(100_000),
  note: z.string().max(500).optional(),
});

export interface AdminQuotaRoutesConfig {
  readonly quotaService: QuotaService;
  readonly userDirectoryRepo: UserDirectoryRepository;
}

export function createAdminQuotaRoutes(
  config: AdminQuotaRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { quotaService, userDirectoryRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // GET /admin/quota/users?surface=…
  app.get(
    "/admin/quota/users",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const surfaceParam = c.req.query("surface") ?? "playground";
      const parsedSurface = surfaceSchema.safeParse(surfaceParam);
      if (!parsedSurface.success) {
        throw new AppError(400, "invalid_surface", "Invalid surface query parameter");
      }
      const surface = parsedSurface.data;
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const q = (c.req.query("q") ?? "").trim();
      const now = new Date();
      const { monthMarker, monthStart, monthEnd } = monthBounds(now);

      const userPool = await userDirectoryRepo.searchByEmailPrefix(q, pageSize * 5);
      const knownAdmins = await userDirectoryRepo.listAdminUserIds();
      const normalUsers = userPool.filter((u) => !knownAdmins.has(u.userId));
      const slice = normalUsers.slice((page - 1) * pageSize, page * pageSize);

      const rows = await Promise.all(
        slice.map(async (u) => {
          const snap = await quotaService.getSnapshot({
            userId: u.userId,
            permissions: undefined,
          });
          const s = snap[surface];
          return {
            userId: u.userId,
            email: u.email,
            displayName: u.displayName,
            defaultAllotment: s.defaultAllotment,
            adminGrant: s.adminGrant,
            used: s.used,
            remaining: s.remaining,
          };
        }),
      );

      return c.json({
        data: {
          items: rows,
          page,
          pageSize,
          total: normalUsers.length,
          totalPages: Math.max(1, Math.ceil(normalUsers.length / pageSize)),
          monthMarker,
          monthStart: monthStart.toISOString(),
          monthEnd: monthEnd.toISOString(),
        },
        error: null,
      });
    },
  );

  // GET /admin/quota/users/:userId/lifetime?surface=…
  app.get(
    "/admin/quota/users/:userId/lifetime",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const userId = c.req.param("userId");
      if (!userId) throw new AppError(400, "invalid_user_id", "userId is required");
      const surfaceParam = c.req.query("surface") ?? "playground";
      const parsedSurface = surfaceSchema.safeParse(surfaceParam);
      if (!parsedSurface.success) {
        throw new AppError(400, "invalid_surface", "Invalid surface query parameter");
      }
      const surface = parsedSurface.data;
      const buckets = await quotaService.getLifetime(userId, surface);
      const items = buckets.map((b) => ({
        monthMarker: b.monthMarker,
        monthStart: b.monthStart instanceof Date ? b.monthStart.toISOString() : String(b.monthStart),
        monthEnd: b.monthEnd instanceof Date ? b.monthEnd.toISOString() : String(b.monthEnd),
        used: b.used,
        defaultAllotment: b.defaultAllotment,
        adminGrant: b.adminGrant,
        usedByModel: b.usedByModel ?? {},
      }));
      const { monthMarker } = monthBounds(new Date());
      return c.json({ data: { items, currentMonth: monthMarker }, error: null });
    },
  );

  // POST /admin/quota/grant
  app.post(
    "/admin/quota/grant",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    validateBody(grantSchema, "INVALID_GRANT_BODY"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<z.infer<typeof grantSchema>>(c);
      try {
        const { auditId, monthMarker, newAdminGrant } = await quotaService.grant({
          admin: {
            userId: authCtx.userId,
            email: authCtx.email,
            displayName: authCtx.displayName,
          },
          targetUserId: body.userId,
          surface: body.surface,
          amount: body.amount,
          // exactOptionalPropertyTypes (#657)
          ...(body.note !== undefined ? { note: body.note } : {}),
        });
        logger.info(
          {
            adminUserId: authCtx.userId,
            targetUserId: body.userId,
            surface: body.surface,
            amount: body.amount,
            monthMarker,
          },
          "Admin issued quota grant",
        );
        return c.json({
          data: { auditId, applied: 1, monthMarker, newAdminGrant },
          error: null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new AppError(400, "invalid_grant_amount", msg);
      }
    },
  );

  // POST /admin/quota/grant/bulk
  app.post(
    "/admin/quota/grant/bulk",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    validateBody(bulkGrantSchema, "INVALID_BULK_GRANT_BODY"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<z.infer<typeof bulkGrantSchema>>(c);
      const unique = Array.from(new Set(body.userIds));
      const results = await quotaService.bulkGrant({
        admin: {
          userId: authCtx.userId,
          email: authCtx.email,
          displayName: authCtx.displayName,
        },
        targetUserIds: unique,
        surface: body.surface,
        amount: body.amount,
        // exactOptionalPropertyTypes (#657)
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
      const applied = results.filter((r) => r.ok).length;
      const { monthMarker } = monthBounds(new Date());
      logger.info(
        {
          adminUserId: authCtx.userId,
          surface: body.surface,
          amount: body.amount,
          requested: unique.length,
          applied,
        },
        "Admin issued bulk quota grant",
      );
      return c.json({
        data: { applied, requested: unique.length, monthMarker, results },
        error: null,
      });
    },
  );

  // GET /admin/quota/grants
  app.get(
    "/admin/quota/grants",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      // Clamp to MAX_PAGE so a huge ?page= can't drive an unbounded
      // `.skip()` scan in the grant-audit query (CWE-770, #810).
      const page = Math.min(MAX_PAGE, Math.max(1, Number(c.req.query("page")) || 1));
      const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize")) || 50));
      const targetUserId = c.req.query("userId") || undefined;
      const adminUserId = c.req.query("adminUserId") || undefined;
      const result = await quotaService.listGrantAudit({
        page,
        pageSize,
        // exactOptionalPropertyTypes (#657)
        ...(targetUserId !== undefined ? { targetUserId } : {}),
        ...(adminUserId !== undefined ? { adminUserId } : {}),
      });
      return c.json({
        data: {
          items: result.items.map((row) => ({
            ...row,
            createdAt:
              row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : String(row.createdAt),
          })),
          total: result.total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
        },
        error: null,
      });
    },
  );

  return app;
}
