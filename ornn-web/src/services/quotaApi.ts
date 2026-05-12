/**
 * Quota HTTP client — wraps `/api/v1/me/quota` (caller snapshot) and the
 * `/api/v1/admin/quota/*` admin grant + audit endpoints.
 *
 * Mirrors the backend types in `ornn-api/src/domains/quota/types.ts` and
 * `ornn-api/src/domains/quota/routes.ts` so the picker/UI consumes the
 * same shape the API emits.
 *
 * v1 minor bump (RT-ME-QUOTA-SHAPE): `daily.*` removed from `/me/quota`
 * payload. Zod parser actively rejects payloads that still carry it so
 * a backend regression is caught loudly on the client.
 *
 * @module services/quotaApi
 */

import { apiGet, apiPost } from "./apiClient";
import { encodeErrorPayload } from "@/utils/translateError";
import { QuotaSnapshotSchema, type QuotaSnapshot } from "./quotaApi.schema";

export type { QuotaSnapshot, SurfaceSnapshot } from "./quotaApi.schema";

export type Surface = "playground" | "skillGen";

export async function fetchMyQuota(): Promise<QuotaSnapshot> {
  const res = await apiGet<unknown>("/api/v1/me/quota");
  if (!res.data) {
    throw new Error("errors.api.quota.snapshotMissing");
  }
  const parsed = QuotaSnapshotSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(
      encodeErrorPayload({
        key: "errors.api.quota.snapshotShapeInvalid",
        params: { detail: parsed.error.message },
      }),
    );
  }
  return parsed.data;
}

/** Per-user row in the admin quota table. */
export interface AdminQuotaRow {
  userId: string;
  email: string;
  displayName: string;
  /** True when the user holds `ornn:admin:skill` — these rows render as
   * "Admin · Unlimited" and the per-row Grant action is suppressed. */
  isAdmin: boolean;
  defaultAllotment: number;
  adminGrant: number;
  used: number;
  remaining: number;
}

/** Calendar-month banner data, identical for every row on a page. */
export interface AdminQuotaBanner {
  monthMarker: string;
  monthStart: string;
  monthEnd: string;
}

export interface AdminQuotaPage {
  items: AdminQuotaRow[];
  banner: AdminQuotaBanner;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function fetchAdminQuotaUsers(params: {
  surface: Surface;
  page?: number;
  pageSize?: number;
  q?: string;
}): Promise<AdminQuotaPage> {
  const res = await apiGet<AdminQuotaPage>("/api/v1/admin/quota/users", {
    surface: params.surface,
    page: params.page,
    pageSize: params.pageSize,
    q: params.q,
  });
  if (!res.data) {
    throw new Error("errors.api.quota.adminListMissing");
  }
  return res.data;
}

export interface LifetimeBucket {
  monthMarker: string;
  monthStart: string;
  monthEnd: string;
  defaultAllotment: number;
  adminGrant: number;
  used: number;
  usedByModel: Record<string, number>;
}

export interface LifetimeResponse {
  items: LifetimeBucket[];
  /** Inclusive of the current month bucket (also present in `items` if seen). */
  currentMonthMarker: string;
  firstJoinedAt: string | null;
}

export async function fetchUserLifetimeQuota(params: {
  userId: string;
  surface: Surface;
}): Promise<LifetimeResponse> {
  const res = await apiGet<LifetimeResponse>(
    `/api/v1/admin/quota/users/${encodeURIComponent(params.userId)}/lifetime`,
    { surface: params.surface },
  );
  if (!res.data) {
    throw new Error("errors.api.quota.lifetimeMissing");
  }
  return res.data;
}

export interface GrantInput {
  userId: string;
  surface: Surface;
  /** Positive integer ≤ 100_000. Validated client-side too for fast feedback. */
  amount: number;
  note?: string;
}

export interface GrantResult {
  auditId: string;
  applied: number;
  monthMarker: string;
  newAdminGrant: number;
}

export async function grantQuota(input: GrantInput): Promise<GrantResult> {
  const res = await apiPost<GrantResult>("/api/v1/admin/quota/grant", input);
  if (!res.data) {
    throw new Error("errors.api.quota.grantMissing");
  }
  return res.data;
}

export interface BulkGrantInput {
  userIds: string[];
  surface: Surface;
  amount: number;
  note?: string;
}

export interface BulkGrantOutcome {
  applied: number;
  requested: number;
  monthMarker: string;
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
    throw new Error("errors.api.quota.bulkGrantMissing");
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
  monthMarker: string;
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
    throw new Error("errors.api.quota.auditListMissing");
  }
  return res.data;
}

// Test-only export — Zod parser surfaced for unit tests asserting that
// payloads carrying the old `daily.*` shape are rejected.
export const __test__ = { QuotaSnapshotSchema };
