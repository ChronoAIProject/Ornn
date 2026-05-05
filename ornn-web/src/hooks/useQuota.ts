/**
 * Quota hooks — caller snapshot + admin grant mutations.
 *
 * `useMyQuota` is the chip / drawer / banner / playground in-context source.
 * Grant hooks invalidate the relevant cache keys so the admin Users + caller
 * counters refresh in lockstep when admins issue credits.
 *
 * @module hooks/useQuota
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useIsAuthenticated } from "@/stores/authStore";
import {
  bulkGrantQuota,
  fetchAdminQuotaGrants,
  fetchAdminQuotaUsers,
  fetchMyQuota,
  grantQuota,
  type BulkGrantInput,
  type BulkGrantOutcome,
  type GrantInput,
  type QuotaSnapshot,
  type Surface,
} from "@/services/quotaApi";

export const MY_QUOTA_KEY = ["me", "quota"] as const;

/**
 * Caller-scoped quota snapshot. Polls every 60s while the tab is visible
 * so the chip / drawer stay accurate after charges land. Disabled for
 * anonymous callers.
 */
export function useMyQuota(): UseQueryResult<QuotaSnapshot> {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: MY_QUOTA_KEY,
    queryFn: fetchMyQuota,
    enabled: isAuthed,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

/**
 * Resolve a single surface's snapshot from the cached caller quota.
 * Returns undefined while the query is in flight or for admins (admins
 * still get a snapshot but the consumer typically wants to skip the chip
 * — checking `quota?.isAdmin` is the right gate).
 */
export function useSurfaceQuota(
  surface: Surface,
): { snapshot: QuotaSnapshot["playground"] | undefined; quota: QuotaSnapshot | undefined; isLoading: boolean } {
  const q = useMyQuota();
  const surfaceData = q.data
    ? surface === "playground"
      ? q.data.playground
      : q.data.skillGen
    : undefined;
  return {
    snapshot: surfaceData,
    quota: q.data,
    isLoading: q.isLoading,
  };
}

export function useAdminQuotaUsers(params: {
  page?: number;
  pageSize?: number;
  q?: string;
}) {
  return useQuery({
    queryKey: ["admin", "quota", "users", params] as const,
    queryFn: () => fetchAdminQuotaUsers(params),
    staleTime: 15_000,
  });
}

export function useGrantQuota() {
  const qc = useQueryClient();
  return useMutation<{ auditId: string }, Error, GrantInput>({
    mutationFn: grantQuota,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "quota"] });
      qc.invalidateQueries({ queryKey: MY_QUOTA_KEY });
    },
  });
}

export function useBulkGrantQuota() {
  const qc = useQueryClient();
  return useMutation<BulkGrantOutcome, Error, BulkGrantInput>({
    mutationFn: bulkGrantQuota,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "quota"] });
      qc.invalidateQueries({ queryKey: MY_QUOTA_KEY });
    },
  });
}

export function useAdminQuotaGrants(params: {
  page?: number;
  pageSize?: number;
  userId?: string;
  adminUserId?: string;
}) {
  return useQuery({
    queryKey: ["admin", "quota", "grants", params] as const,
    queryFn: () => fetchAdminQuotaGrants(params),
    staleTime: 30_000,
  });
}
