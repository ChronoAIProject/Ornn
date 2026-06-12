/**
 * React Query hooks for per-skill analytics.
 *
 * @module hooks/useAnalytics
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchSkillAnalytics, fetchSkillPulls } from "@/services/analyticsApi";
import type {
  AnalyticsWindow,
  PullBucket,
  PullBucketCount,
  SkillAnalyticsSummary,
} from "@/types/analytics";

export function useSkillAnalytics(
  idOrName: string | undefined,
  // exactOptionalPropertyTypes (#657)
  options: { window?: AnalyticsWindow | undefined; version?: string | undefined } = {},
) {
  const window = options.window ?? "30d";
  return useQuery<SkillAnalyticsSummary | null>({
    queryKey: ["analytics", idOrName ?? "", window, options.version ?? "__all__"] as const,
    queryFn: () => fetchSkillAnalytics(idOrName!, { window, version: options.version }),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
  });
}

/**
 * Pull time-series. Used by the chart on `SkillDetailPage`. Server-side
 * filters by version + date range; this hook is just a thin wrapper.
 */
export function useSkillPulls(
  idOrName: string | undefined,
  // exactOptionalPropertyTypes (#657)
  options: {
    bucket: PullBucket;
    from?: string | undefined;
    to?: string | undefined;
    version?: string | undefined;
  },
) {
  return useQuery<PullBucketCount[]>({
    queryKey: [
      "analytics-pulls",
      idOrName ?? "",
      options.bucket,
      options.from ?? "__default__",
      options.to ?? "__default__",
      options.version ?? "__all__",
    ] as const,
    queryFn: () =>
      fetchSkillPulls(idOrName!, {
        bucket: options.bucket,
        from: options.from,
        to: options.to,
        version: options.version,
      }),
    enabled: Boolean(idOrName),
    staleTime: 60_000,
    // Keep the previous bucket's data on the screen while a new bucket
    // refetches — eliminates the unmount/remount flash when the user
    // switches Hour ⇄ Day ⇄ Month.
    placeholderData: keepPreviousData,
  });
}
