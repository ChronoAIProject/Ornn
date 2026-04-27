/**
 * React Query hooks for the skill-audit endpoints.
 *
 * @module hooks/useAudit
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchAudit,
  fetchAuditHistory,
  fetchAuditSummaryByVersion,
  startAudit,
  type FetchAuditOptions,
} from "@/services/auditApi";
import type { AuditRecord } from "@/types/audit";

const auditKey = (idOrName: string, version?: string) =>
  ["audit", idOrName, version ?? "__latest__"] as const;

const auditHistoryKey = (idOrName: string, version?: string) =>
  ["audit", idOrName, "__history__", version ?? "__all__"] as const;

const auditSummaryByVersionKey = (idOrName: string) =>
  ["audit", idOrName, "__summary-by-version__"] as const;

export function useSkillAudit(idOrName: string | undefined, opts: FetchAuditOptions = {}) {
  return useQuery<AuditRecord | null>({
    queryKey: auditKey(idOrName ?? "", opts.version),
    queryFn: () => fetchAudit(idOrName!, opts),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
  });
}

export function useSkillAuditHistory(
  idOrName: string | undefined,
  options: { version?: string } = {},
) {
  return useQuery<AuditRecord[]>({
    queryKey: auditHistoryKey(idOrName ?? "", options.version),
    queryFn: () => fetchAuditHistory(idOrName!, { version: options.version }),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
    // Poll while any audit is still running so the UI flips to completed
    // without the user reloading. Once all rows are terminal, polling
    // stops and we fall back to the 60s staleTime.
    refetchInterval: (query) => {
      const items = query.state.data;
      if (items && items.some((r) => r.status === "running")) return 3000;
      return false;
    },
  });
}

/**
 * Per-version audit badge data. One row per skill version that ever had
 * a completed audit; versions absent from the result render as "not
 * audited yet" pills.
 */
export function useAuditSummaryByVersion(idOrName: string | undefined) {
  return useQuery<Record<string, AuditRecord>>({
    queryKey: auditSummaryByVersionKey(idOrName ?? ""),
    queryFn: () => fetchAuditSummaryByVersion(idOrName!),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
  });
}

export function useStartAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { idOrName: string; version?: string; force?: boolean }) =>
      startAudit({ idOrName: vars.idOrName, force: vars.force }),
    onSuccess: (record, vars) => {
      // Server returns the fresh record synchronously — prime the cache
      // so the history card updates immediately instead of waiting for
      // the next refetch.
      queryClient.setQueryData(auditKey(vars.idOrName, vars.version), record);
      // Invalidate every history-by-version variant for this skill —
      // includes the "all versions" key plus any specific-version keys.
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === "audit" &&
            key[1] === vars.idOrName &&
            (key[2] === "__history__" || key[2] === "__summary-by-version__")
          );
        },
      });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
