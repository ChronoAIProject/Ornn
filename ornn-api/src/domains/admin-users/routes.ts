/**
 * Admin users HTTP surface.
 *
 *   GET /api/v1/admin/users?role=admin|normal&page&pageSize&q&sort&dir
 *
 * Six-column rows per Story 4.1/4.2; admins gated on `ornn:admin:skill`.
 *
 * @module domains/admin-users/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { QUOTA_ADMIN_PERMISSION } from "../quota/types";
import type { AdminUsersService, Role, SortDir, SortKey } from "./service";

const roleSchema = z.enum(["admin", "normal"]);
const sortKeySchema = z.enum([
  "displayName",
  "email",
  "skillCount",
  "lastActiveAt",
  "activityCount",
  "firstJoinedAt",
]);
const dirSchema = z.enum(["asc", "desc"]);

export interface AdminUsersRoutesConfig {
  adminUsersService: AdminUsersService;
}

export function createAdminUsersRoutes(
  config: AdminUsersRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { adminUsersService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.get(
    "/admin/users",
    auth,
    requirePermission(QUOTA_ADMIN_PERMISSION),
    async (c) => {
      const roleParse = roleSchema.safeParse(c.req.query("role") ?? "normal");
      if (!roleParse.success) {
        throw new AppError(400, "INVALID_ROLE", "role must be 'admin' or 'normal'");
      }
      const role: Role = roleParse.data;
      const page = Math.max(1, Number(c.req.query("page")) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(c.req.query("pageSize")) || 20));
      const q = (c.req.query("q") ?? "").trim() || undefined;
      const sortRaw = c.req.query("sort");
      const sortKey: SortKey | undefined = sortRaw
        ? sortKeySchema.parse(sortRaw)
        : undefined;
      const dirRaw = c.req.query("dir");
      const dir: SortDir | undefined = dirRaw ? dirSchema.parse(dirRaw) : undefined;

      const result = await adminUsersService.listUsers({
        role,
        page,
        pageSize,
        q,
        sort: sortKey,
        dir,
      });
      return c.json({ data: result, error: null });
    },
  );

  return app;
}
