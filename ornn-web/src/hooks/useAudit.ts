/**
 * React Query hooks for the skill-audit endpoints.
 *
 * @module hooks/useAudit
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAudit, rerunAudit, type FetchAuditOptions } from "@/services/auditApi";
import type { AuditRecord } from "@/types/audit";

const auditKey = (idOrName: string, version?: string) =>
  ["audit", idOrName, version ?? "__latest__"] as const;

export function useSkillAudit(idOrName: string | undefined, opts: FetchAuditOptions = {}) {
  return useQuery<AuditRecord | null>({
    queryKey: auditKey(idOrName ?? "", opts.version),
    queryFn: () => fetchAudit(idOrName!, opts),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
  });
}

export function useRerunAudit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { idOrName: string; version?: string; force?: boolean }) =>
      rerunAudit({ idOrName: vars.idOrName, force: vars.force }),
    onSuccess: (record, vars) => {
      // The server returns the fresh record synchronously — prime the
      // cache so the banner updates immediately instead of waiting for
      // the next refetch.
      queryClient.setQueryData(auditKey(vars.idOrName, vars.version), record);
      // Invalidate any related keys (notifications may reference audit events).
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
