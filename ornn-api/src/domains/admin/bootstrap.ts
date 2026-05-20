/**
 * Wire the admin domain (#580 — bootstrap decomposition).
 *
 * Bundles the dashboard + users + quota admin surfaces. Each one needs
 * the user directory repo + db handle; the quota admin route also
 * needs the `QuotaService` so it can grant/revoke against current
 * buckets. The three were originally inlined in bootstrap.ts back to
 * back; this lifts them into a single wiring call that returns each
 * route handler so the mount block stays unchanged.
 *
 * The standalone `createAdminRoutes` (skill + generation + agentseal
 * admin) keeps living in bootstrap.ts — it depends on too many
 * cross-cutting clients (skillRepo, skillService, skillVersionRepo,
 * generationService, agentsealScanner) to fit cleanly here.
 *
 * @module domains/admin/bootstrap
 */

import type { Db } from "mongodb";
import type { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { AdminDashboardService } from "./dashboard/service";
import { createAdminDashboardRoutes } from "./dashboard/routes";
import { createAdminQuotaRoutes } from "./quota/routes";
import { AdminUsersService } from "../admin-users/service";
import { createAdminUsersRoutes } from "../admin-users/routes";
import type { UserDirectoryRepository } from "../users/repository";
import type { QuotaService } from "../quota/service";

export interface AdminWiring {
  readonly dashboardRoutes: Hono<{ Variables: AuthVariables }>;
  readonly usersRoutes: Hono<{ Variables: AuthVariables }>;
  readonly quotaRoutes: Hono<{ Variables: AuthVariables }>;
}

export function wireAdmin(deps: {
  db: Db;
  userDirectoryRepo: UserDirectoryRepository;
  quotaService: QuotaService;
}): AdminWiring {
  const dashboardService = new AdminDashboardService({
    db: deps.db,
    userDirectoryRepo: deps.userDirectoryRepo,
  });
  const dashboardRoutes = createAdminDashboardRoutes({
    dashboardService,
  });
  const usersService = new AdminUsersService({
    db: deps.db,
    userDirectoryRepo: deps.userDirectoryRepo,
  });
  const usersRoutes = createAdminUsersRoutes({ adminUsersService: usersService });
  const quotaRoutes = createAdminQuotaRoutes({
    quotaService: deps.quotaService,
    userDirectoryRepo: deps.userDirectoryRepo,
  });
  return { dashboardRoutes, usersRoutes, quotaRoutes };
}
