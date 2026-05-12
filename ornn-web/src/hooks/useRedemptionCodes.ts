/**
 * Redemption-code hooks — admin mint/list/invalidate + caller redeem
 * and history. Mirrors `hooks/useQuota.ts` so the admin tables and
 * caller surfaces refresh in lockstep when codes are issued or
 * consumed.
 *
 * `useRedeemCode` invalidates `["me", "quota"]` so a successful redeem
 * visually refreshes the snapshot (chip / drawer / banner) without a
 * manual reload. Mint and invalidate flow back into
 * `["admin", "redemption-codes"]` so the admin table updates without
 * a refetch click.
 *
 * @module hooks/useRedemptionCodes
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useIsAuthenticated } from "@/stores/authStore";
import {
  getAdminCodeDetail,
  invalidateCode,
  listAdminCodes,
  listMyRedemptionHistory,
  mintCode,
  redeemCode,
  type AdminRedemptionCodeFilters,
  type MintCodeRequest,
  type MintCodeResponse,
  type RedeemCodeResponse,
  type RedemptionCode,
  type RedemptionCodeListResponse,
  type RedemptionHistoryResponse,
} from "@/services/redemptionCodesApi";

const ADMIN_REDEMPTION_CODES_KEY = ["admin", "redemption-codes"] as const;
const ME_QUOTA_KEY = ["me", "quota"] as const;
const ME_REDEMPTION_HISTORY_KEY = ["me", "redemption-codes", "history"] as const;

export function useAdminRedemptionCodes(
  filters: AdminRedemptionCodeFilters = {},
): UseQueryResult<RedemptionCodeListResponse> {
  return useQuery({
    queryKey: [...ADMIN_REDEMPTION_CODES_KEY, filters] as const,
    queryFn: () => listAdminCodes(filters),
    staleTime: 15_000,
  });
}

export function useAdminRedemptionCodeDetail(
  id: string | null,
): UseQueryResult<RedemptionCode> {
  return useQuery({
    queryKey: [...ADMIN_REDEMPTION_CODES_KEY, "detail", id] as const,
    queryFn: () => getAdminCodeDetail(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useMintCode() {
  const qc = useQueryClient();
  return useMutation<MintCodeResponse, Error, MintCodeRequest>({
    mutationFn: mintCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_REDEMPTION_CODES_KEY });
    },
  });
}

export function useInvalidateCode() {
  const qc = useQueryClient();
  return useMutation<RedemptionCode, Error, string>({
    mutationFn: invalidateCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ADMIN_REDEMPTION_CODES_KEY });
    },
  });
}

export function useRedeemCode() {
  const qc = useQueryClient();
  return useMutation<RedeemCodeResponse, Error, string>({
    mutationFn: redeemCode,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ME_QUOTA_KEY });
      qc.invalidateQueries({ queryKey: ME_REDEMPTION_HISTORY_KEY });
    },
  });
}

export function useMyRedemptionHistory(params: {
  page?: number;
  pageSize?: number;
} = {}): UseQueryResult<RedemptionHistoryResponse> {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: [...ME_REDEMPTION_HISTORY_KEY, params] as const,
    queryFn: () => listMyRedemptionHistory(params),
    enabled: isAuthed,
    staleTime: 30_000,
  });
}
