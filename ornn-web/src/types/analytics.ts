/**
 * Skill-analytics types. Mirrors the backend `SkillAnalyticsSummary`.
 *
 * @module types/analytics
 */

export type AnalyticsWindow = "7d" | "30d" | "all";

export interface SkillAnalyticsLatency {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface SkillAnalyticsSummary {
  skillGuid: string;
  window: AnalyticsWindow;
  /** When set, the summary was filtered to this version. */
  version?: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  /** Decimal in [0, 1]; `null` when no executions. */
  successRate: number | null;
  latencyMs: SkillAnalyticsLatency;
  uniqueUsers: number;
  topErrorCodes: Array<{ code: string; count: number }>;
}

/** Granularity of a pull-time-series query. */
export type PullBucket = "hour" | "day" | "month";

/** One bucket of the pull time series. `bucket` is an ISO-8601 timestamp. */
export interface PullBucketCount {
  bucket: string;
  total: number;
  bySource: { api: number; web: number; playground: number };
}
