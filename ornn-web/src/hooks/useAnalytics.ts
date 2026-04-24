/**
 * React Query hook for per-skill analytics.
 *
 * @module hooks/useAnalytics
 */

import { useQuery } from "@tanstack/react-query";
import { fetchSkillAnalytics } from "@/services/analyticsApi";
import type { AnalyticsWindow, SkillAnalyticsSummary } from "@/types/analytics";

export function useSkillAnalytics(
  idOrName: string | undefined,
  window: AnalyticsWindow = "30d",
) {
  return useQuery<SkillAnalyticsSummary | null>({
    queryKey: ["analytics", idOrName ?? "", window] as const,
    queryFn: () => fetchSkillAnalytics(idOrName!, { window }),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
  });
}
