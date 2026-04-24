/**
 * Skill analytics endpoints — `/api/v1/skills/:idOrName/analytics`.
 *
 * @module services/analyticsApi
 */

import { apiGet } from "./apiClient";
import type { AnalyticsWindow, SkillAnalyticsSummary } from "@/types/analytics";

export interface FetchAnalyticsOptions {
  window?: AnalyticsWindow;
}

export async function fetchSkillAnalytics(
  idOrName: string,
  opts: FetchAnalyticsOptions = {},
): Promise<SkillAnalyticsSummary | null> {
  const params: Record<string, string | undefined> = {};
  if (opts.window) params.window = opts.window;
  const res = await apiGet<SkillAnalyticsSummary>(
    `/api/v1/skills/${encodeURIComponent(idOrName)}/analytics`,
    params,
  );
  return res.data ?? null;
}
