/**
 * Admin dashboard HTTP surface.
 *
 *   GET /api/v1/admin/dashboard/stats              — user + skill totals.
 *   GET /api/v1/admin/dashboard/recent-activities  — top-N activities.
 *
 * Both gated on `ornn:admin:skill`.
 *
 * @module domains/admin/dashboard/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../../middleware/nyxidAuth";
import { QUOTA_ADMIN_PERMISSION } from "../../quota/types";
import type { AdminDashboardService } from "./service";

export interface AdminDashboardRoutesConfig {
  dashboardService: AdminDashboardService;
}

export function createAdminDashboardRoutes(
  config: AdminDashboardRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { dashboardService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get(
    "/admin/dashboard/stats",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const stats = await dashboardService.getStats();
      return c.json({ data: stats, error: null });
    },
  );

  app.get(
    "/admin/dashboard/recent-activities",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
      const items = await dashboardService.listRecentActivities(limit);
      return c.json({ data: { items, limit }, error: null });
    },
  );

  return app;
}
