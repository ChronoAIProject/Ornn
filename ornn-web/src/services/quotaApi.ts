/**
 * Quota HTTP client — wraps `/api/v1/me/quota` (caller snapshot) and the
 * `/api/v1/admin/quota/*` admin grant + audit endpoints.
 *
 * Mirrors the backend types in `ornn-api/src/domains/quota/types.ts` and
 * `ornn-api/src/domains/quota/routes.ts` so the picker/UI consumes the
 * same shape the API emits.
 *
 * @module services/quotaApi
 */

import { apiGet, apiPost } from "./apiClient";

export type Surface = "playground" | "skillGen";

export interface SurfaceSnapshot {
  monthly: { limit: number; used: number; remaining: number };
  daily: { limit: number; used: number; remaining: number };
  credits: { balance: number };
  warningThreshold: number;
  warning: boolean;
  monthlyResetAt: string;
  dailyResetAt: string;
}

export interface QuotaSnapshot {
  playground: SurfaceSnapshot;
  skillGen: SurfaceSnapshot;
  isAdmin: boolean;
}

export async function fetchMyQuota(): Promise<QuotaSnapshot> {
  const res = await apiGet<QuotaSnapshot>("/api/v1/me/quota");
  if (!res.data) {
    throw new Error("Quota snapshot missing");
  }
  return res.data;
}

export interface AdminQuotaRow {
  userId: string;
  email: string;
  displayName: string;
  /**
   * True when this user carries the `ornn:admin:skill` permission per
   * the lazily-tracked `admin_users` collection (populated by the auth
   * setup layer whenever an admin authenticates). Drives the UI to
   * render "Admin · Unlimited" instead of usage counters and disables
   * the per-row Grant action.
   */
  isAdmin: boolean;
  playground: AdminQuotaSurfaceStatus;
  skillGen: AdminQuotaSurfaceStatus;
}

export interface AdminQuotaSurfaceStatus {
  /** Calls used in the current monthly window. */
  monthlyUsed: number;
  /** Original monthly base — what the user gets each rollover. */
  monthlyLimit: number;
  /** Calls used in the current daily window. */
  dailyUsed: number;
  /** Daily ceiling for this surface. */
  dailyLimit: number;
  /**
   * Total active granted credits = legacy non-expiring bucket PLUS
   * sum of unused capacity across active grants in the ledger.
   */
  creditsBalance: number;
}

export interface AdminQuotaPage {
  items: AdminQuotaRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function fetchAdminQuotaUsers(params: {
  page?: number;
  pageSize?: number;
  q?: string;
}): Promise<AdminQuotaPage> {
  const res = await apiGet<AdminQuotaPage>("/api/v1/admin/quota/users", {
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
  });
  if (!res.data) {
    throw new Error("Admin quota list missing");
  }
  return res.data;
}

export interface GrantInput {
  userId: string;
  surface: Surface;
  amount: number;
  /**
   * How many UTC months the grant stays active before unused capacity
   * drops out of the balance. Omit / set null to grant credits that
   * never expire.
   */
  periodMonths?: number | null;
  note?: string;
}

export async function grantQuota(
  input: GrantInput,
): Promise<{ auditId: string; expiresAt: string | null }> {
  const res = await apiPost<{ auditId: string; applied: number; expiresAt: string | null }>(
    "/api/v1/admin/quota/grant",
    input,
  );
  if (!res.data) {
    throw new Error("Grant response missing");
  }
  return { auditId: res.data.auditId, expiresAt: res.data.expiresAt ?? null };
}

export interface BulkGrantInput {
  userIds: string[];
  surface: Surface;
  amount: number;
  periodMonths?: number | null;
  note?: string;
}

export interface BulkGrantOutcome {
  applied: number;
  requested: number;
  results: Array<{
    userId: string;
    ok: boolean;
    auditId?: string;
    reason?: string;
  }>;
}

export async function bulkGrantQuota(
  input: BulkGrantInput,
): Promise<BulkGrantOutcome> {
  const res = await apiPost<BulkGrantOutcome>(
    "/api/v1/admin/quota/grant/bulk",
    input,
  );
  if (!res.data) {
    throw new Error("Bulk grant response missing");
  }
  return res.data;
}

export interface QuotaGrantAuditRow {
  _id: string;
  adminUserId: string;
  adminEmail: string;
  adminDisplayName: string;
  targetUserId: string;
  surface: Surface;
  amount: number;
  createdAt: string;
  note?: string;
}

export interface QuotaGrantAuditPage {
  items: QuotaGrantAuditRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function fetchAdminQuotaGrants(params: {
  page?: number;
  pageSize?: number;
  userId?: string;
  adminUserId?: string;
}): Promise<QuotaGrantAuditPage> {
  const res = await apiGet<QuotaGrantAuditPage>("/api/v1/admin/quota/grants", {
    page: params.page,
    pageSize: params.pageSize,
    userId: params.userId,
    adminUserId: params.adminUserId,
  });
  if (!res.data) {
    throw new Error("Audit list missing");
  }
  return res.data;
}
