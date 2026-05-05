/**
 * Quota HTTP surface.
 *
 *   /api/v1/me/quota                — caller snapshot.
 *   /api/v1/admin/quota/users       — admin list of users + their counters.
 *   /api/v1/admin/quota/grant       — single-user grant.
 *   /api/v1/admin/quota/grant/bulk  — bulk grant.
 *   /api/v1/admin/quota/grants      — paginated audit trail.
 *
 * Admin routes are gated on `ornn:admin:skill` (same gate as the rest
 * of the admin panel — adding a dedicated `ornn:admin:quota` permission
 * is a phase-2 follow-up tracked alongside org-level quotas).
 *
 * @module domains/quota/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import pino from "pino";
import {
  type AuthVariables,
  getAuth,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { AppError } from "../../shared/types/index";
import type { ActivityRepository } from "../admin/activityRepository";
import type { QuotaService } from "./service";
import {
  QUOTA_ADMIN_PERMISSION,
  SURFACES,
  type Surface,
  type SurfaceCounter,
  type UserQuotaDocument,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "quotaRoutes" });

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

export interface QuotaRoutesConfig {
  readonly quotaService: QuotaService;
  readonly activityRepo: ActivityRepository;
}

export function createQuotaRoutes(config: QuotaRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { quotaService, activityRepo } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  // -------------------------------------------------------------------------
  // GET /me/quota — caller's own snapshot
  // -------------------------------------------------------------------------
  app.get("/me/quota", auth, async (c) => {
    const authCtx = getAuth(c);
    const snapshot = await quotaService.getSnapshot({
      userId: authCtx.userId,
      permissions: authCtx.permissions,
    });
    return c.json({ data: snapshot, error: null });
  });

  // -------------------------------------------------------------------------
  // GET /admin/quota/users — paginated list + counter decoration
  // -------------------------------------------------------------------------
  app.get(
    "/admin/quota/users",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const q = (c.req.query("q") ?? "").trim();

      // Reuse the activity-driven user pool (same source the existing
      // admin/users endpoint uses) so quota admin shows the same set the
      // ops team already understands.
      const userPool = await activityRepo.searchUsersByEmail(q, pageSize * 5);
      const slice = userPool.slice((page - 1) * pageSize, page * pageSize);
      const userIds = slice.map((u) => u.userId);
      const quotaDocs = await Promise.all(
        userIds.map((id) => quotaService.getUserQuota(id)),
      );
      const items = slice.map((u, i) => decorateAdminRow(u, quotaDocs[i]));
      return c.json({
        data: {
          items,
          page,
          pageSize,
          total: userPool.length,
          totalPages: Math.max(1, Math.ceil(userPool.length / pageSize)),
        },
        error: null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /admin/quota/grant — single-user grant
  // -------------------------------------------------------------------------
  app.post(
    "/admin/quota/grant",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    validateBody(grantSchema, "INVALID_GRANT_BODY"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<z.infer<typeof grantSchema>>(c);
      const { auditId } = await quotaService.grant({
        admin: {
          userId: authCtx.userId,
          email: authCtx.email,
          displayName: authCtx.displayName,
        },
        targetUserId: body.userId,
        surface: body.surface,
        amount: body.amount,
        note: body.note,
      });
      logger.info(
        {
          adminUserId: authCtx.userId,
          targetUserId: body.userId,
          surface: body.surface,
          amount: body.amount,
        },
        "Admin issued quota grant",
      );
      return c.json({ data: { auditId, applied: 1 }, error: null });
    },
  );

  // -------------------------------------------------------------------------
  // POST /admin/quota/grant/bulk — bulk grant
  // -------------------------------------------------------------------------
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
        note: body.note,
      });
      const applied = results.filter((r) => r.ok).length;
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
        data: { applied, requested: unique.length, results },
        error: null,
      });
    },
  );

  // -------------------------------------------------------------------------
  // GET /admin/quota/grants — paginated audit trail
  // -------------------------------------------------------------------------
  app.get(
    "/admin/quota/grants",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize")) || 50));
      const targetUserId = c.req.query("userId") || undefined;
      const adminUserId = c.req.query("adminUserId") || undefined;
      const result = await quotaService.listGrants({
        page,
        pageSize,
        targetUserId,
        adminUserId,
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

interface AdminRow {
  userId: string;
  email: string;
  displayName: string;
  playground: SurfaceSummary;
  skillGen: SurfaceSummary;
}

interface SurfaceSummary {
  monthlyUsed: number;
  dailyUsed: number;
  creditsBalance: number;
}

function decorateAdminRow(
  user: { userId: string; email: string; displayName: string },
  quota: UserQuotaDocument,
): AdminRow {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    playground: summarize(quota.playground),
    skillGen: summarize(quota.skillGen),
  };
}

function summarize(c: SurfaceCounter): SurfaceSummary {
  return {
    monthlyUsed: c.monthlyUsed,
    dailyUsed: c.dailyUsed,
    creditsBalance: c.creditsBalance,
  };
}

/**
 * Convenience helper for the playground / skill-gen routes: turn a
 * `QuotaDecision` into the standard 429 response shape.
 */
export function throwQuotaError(decision: {
  allowed: false;
  surface: Surface;
  scope: "monthly" | "daily";
  message: string;
}): never {
  throw new AppError(429, "QUOTA_EXCEEDED", decision.message);
}
