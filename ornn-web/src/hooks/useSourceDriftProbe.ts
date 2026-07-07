/**
 * Lazy on-view drift freshening (#1178).
 *
 * When a GitHub-sourced skill's last drift check is stale, re-read the skill
 * detail ONCE on view so the auto-sync badge reflects anything the scheduled
 * cron (#1176, the primary mechanism) recorded since this query was cached.
 *
 * Guarantees: fires at most once per mount (ref-guarded), only when
 * `lastCheckedAt` is older than {@link SOURCE_DRIFT_STALE_MS}, and never via a
 * timer/interval — so there is no request storm. The backend surfaces
 * `driftState` on GET, so a plain refetch is sufficient (no bespoke endpoint).
 *
 * @module hooks/useSourceDriftProbe
 */
import { useEffect, useRef } from "react";
import type { SkillSource } from "@/types/domain";

/** Max age of `lastCheckedAt` before an on-view refetch is worthwhile. */
export const SOURCE_DRIFT_STALE_MS = 5 * 60 * 1000;

export function useSourceDriftProbe(
  source: SkillSource | undefined,
  refetch: () => void,
): void {
  const probedRef = useRef(false);
  useEffect(() => {
    if (probedRef.current) return;
    if (source?.type !== "github") return;
    const lastChecked = source.lastCheckedAt ? new Date(source.lastCheckedAt).getTime() : 0;
    if (Date.now() - lastChecked < SOURCE_DRIFT_STALE_MS) return; // fresh enough
    probedRef.current = true;
    refetch();
  }, [source, refetch]);
}
