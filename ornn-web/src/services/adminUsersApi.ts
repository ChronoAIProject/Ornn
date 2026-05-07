/**
 * Admin users API — paginated user list with role filter, search, sort.
 *
 * Mirrors `GET /api/v1/admin/users?role=admin|normal&q&page&pageSize&sort`.
 *
 * `firstJoinedAt` is synthesized server-side from MIN(activities.createdAt)
 * and may be null for accounts with no recorded activity (rendered as
 * `—` by AdminUsersTable). `lastActiveAt` may also be null and renders
 * as `Never`.
 *
 * @module services/adminUsersApi
 */

import { apiGet } from "./apiClient";

export type AdminUserRole = "admin" | "normal";

export type AdminUsersSort =
  | "lastActiveAt:desc"
  | "lastActiveAt:asc"
  | "firstJoinedAt:desc"
  | "firstJoinedAt:asc"
  | "skillCount:desc"
  | "skillCount:asc"
  | "activityCount:desc"
  | "activityCount:asc"
  | "displayName:asc"
  | "displayName:desc"
  | "email:asc"
  | "email:desc";

export interface AdminUserRow {
  userId: string;
  email: string;
  displayName: string;
  skillCount: number;
  lastActiveAt: string | null;
  activityCount: number;
  firstJoinedAt: string | null;
}

export interface AdminUsersPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchAdminUsers(params: {
  role: AdminUserRole;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: AdminUsersSort;
}): Promise<AdminUsersPage> {
  const res = await apiGet<AdminUsersPage>("/api/v1/admin/users", {
    role: params.role,
    q: params.q,
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
  });
  if (!res.data) {
    throw new Error("Admin users list missing");
  }
  return res.data;
}
