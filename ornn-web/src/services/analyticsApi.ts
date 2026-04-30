/**
 * Skill analytics endpoints — `/api/v1/skills/:idOrName/analytics` and the
 * pull time-series endpoint at `/analytics/pulls`.
 *
 * @module services/analyticsApi
 */

import { apiGet } from "./apiClient";
import type {
  AnalyticsWindow,
  PullBucket,
  PullBucketCount,
  SkillAnalyticsSummary,
} from "@/types/analytics";

export interface FetchAnalyticsOptions {
  window?: AnalyticsWindow;
  /** Optional version filter; matches the same query the backend supports. */
  version?: string;
}

export async function fetchSkillAnalytics(
  idOrName: string,
  opts: FetchAnalyticsOptions = {},
): Promise<SkillAnalyticsSummary | null> {
  const params: Record<string, string | undefined> = {};
  if (opts.window) params.window = opts.window;
  if (opts.version) params.version = opts.version;
  const res = await apiGet<SkillAnalyticsSummary>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/analytics`,
    params,
  );
  return res.data ?? null;
}

export interface FetchPullsOptions {
  bucket: PullBucket;
  /** Inclusive lower bound (ISO string). Backend defaults to last 7 days. */
  from?: string;
  /** Exclusive upper bound (ISO string). Backend defaults to now. */
  to?: string;
  version?: string;
}

export async function fetchSkillPulls(
  idOrName: string,
  opts: FetchPullsOptions,
): Promise<PullBucketCount[]> {
  const params: Record<string, string | undefined> = {
    bucket: opts.bucket,
  };
  if (opts.from) params.from = opts.from;
  if (opts.to) params.to = opts.to;
  if (opts.version) params.version = opts.version;
  const res = await apiGet<{ items: PullBucketCount[] }>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/analytics/pulls`,
    params,
  );
  return res.data?.items ?? [];
}
