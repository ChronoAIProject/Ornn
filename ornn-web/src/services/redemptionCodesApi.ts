/**
 * Redemption-code HTTP client — wraps the admin
 * `/api/v1/admin/redemption-codes/*` mint/list/invalidate endpoints
 * and the caller-scoped `/api/v1/me/redemption-codes/*` redeem and
 * history endpoints.
 *
 * Mirrors the backend shapes in
 * `ornn-api/src/domains/redemption-codes/types.ts` and the route
 * serializers; payloads are validated through the Zod schemas in
 * `redemptionCodesApi.schema.ts` so a backend regression is surfaced
 * loudly on the client.
 *
 * @module services/redemptionCodesApi
 */

import { apiGet, apiPost } from "./apiClient";
import {
  MintCodeResponseSchema,
  RedeemCodeResponseSchema,
  RedemptionCodeListResponseSchema,
  RedemptionCodeSchema,
  RedemptionHistoryResponseSchema,
  type MintCodeRequest,
  type MintCodeResponse,
  type RedeemCodeResponse,
  type RedemptionCode,
  type RedemptionCodeListResponse,
  type RedemptionCodeStatus,
  type RedemptionHistoryResponse,
} from "./redemptionCodesApi.schema";

export type {
  ActorMeta,
  MintCodeRequest,
  MintCodeResponse,
  RedeemAppliedGrant,
  RedeemCodeRequest,
  RedeemCodeResponse,
  RedemptionCode,
  RedemptionCodeListResponse,
  RedemptionCodeStatus,
  RedemptionGrantEntry,
  RedemptionHistoryItem,
  RedemptionHistoryResponse,
  Surface,
} from "./redemptionCodesApi.schema";

export interface AdminRedemptionCodeFilters {
  status?: RedemptionCodeStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function mintCode(req: MintCodeRequest): Promise<MintCodeResponse> {
  const res = await apiPost<unknown>("/api/v1/admin/redemption-codes", req);
  if (!res.data) {
    throw new Error("Mint response missing");
  }
  const parsed = MintCodeResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`Mint response shape invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function listAdminCodes(
  filters: AdminRedemptionCodeFilters = {},
): Promise<RedemptionCodeListResponse> {
  const res = await apiGet<unknown>("/api/v1/admin/redemption-codes", {
    status: filters.status,
    search: filters.search,
    page: filters.page,
    pageSize: filters.pageSize,
  });
  if (!res.data) {
    throw new Error("Admin redemption-code list missing");
  }
  const parsed = RedemptionCodeListResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(
      `Admin redemption-code list shape invalid: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export async function getAdminCodeDetail(id: string): Promise<RedemptionCode> {
  const res = await apiGet<{ code: unknown }>(
    `/api/v1/admin/redemption-codes/${encodeURIComponent(id)}`,
  );
  if (!res.data?.code) {
    throw new Error("Redemption code detail missing");
  }
  const parsed = RedemptionCodeSchema.safeParse(res.data.code);
  if (!parsed.success) {
    throw new Error(`Redemption code shape invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function invalidateCode(id: string): Promise<RedemptionCode> {
  const res = await apiPost<{ code: unknown }>(
    `/api/v1/admin/redemption-codes/${encodeURIComponent(id)}/invalidate`,
    {},
  );
  if (!res.data?.code) {
    throw new Error("Invalidate response missing");
  }
  const parsed = RedemptionCodeSchema.safeParse(res.data.code);
  if (!parsed.success) {
    throw new Error(`Invalidate response shape invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function redeemCode(code: string): Promise<RedeemCodeResponse> {
  const res = await apiPost<unknown>("/api/v1/me/redemption-codes/redeem", {
    code,
  });
  if (!res.data) {
    throw new Error("Redeem response missing");
  }
  const parsed = RedeemCodeResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`Redeem response shape invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function listMyRedemptionHistory(params: {
  page?: number;
  pageSize?: number;
} = {}): Promise<RedemptionHistoryResponse> {
  const res = await apiGet<unknown>("/api/v1/me/redemption-codes/history", {
    page: params.page,
    pageSize: params.pageSize,
  });
  if (!res.data) {
    throw new Error("Redemption history missing");
  }
  const parsed = RedemptionHistoryResponseSchema.safeParse(res.data);
  if (!parsed.success) {
    throw new Error(`Redemption history shape invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Test-only export — Zod parsers surfaced for unit tests.
export const __test__ = {
  MintCodeResponseSchema,
  RedeemCodeResponseSchema,
  RedemptionCodeListResponseSchema,
  RedemptionCodeSchema,
  RedemptionHistoryResponseSchema,
};
