/**
 * Skill-analytics types.
 *
 * v1 captures one event per skill execution from the playground. Future
 * hook points (SDK, nyx CLI, agent proxy) emit the same shape so
 * aggregations stay consistent.
 *
 * @module domains/analytics/types
 */

export type ExecutionOutcome = "success" | "failure" | "timeout";

export interface SkillExecutionEvent {
  readonly _id: string;
  readonly skillGuid: string;
  readonly skillName: string;
  /** Version the caller invoked, e.g. `1.2`. Omitted for playground calls that don't pin a version. */
  readonly skillVersion?: string;
  readonly outcome: ExecutionOutcome;
  /** Wall-clock invocation duration in ms. */
  readonly latencyMs: number;
  /** Caller's NyxID user_id. `anonymous` when the event came from an unauth path. */
  readonly userId: string;
  /** Source that emitted the event. `playground` today; `sdk` / `cli` / `agent-proxy` later. */
  readonly source: "playground" | "sdk" | "cli" | "agent-proxy";
  /** Short error code when `outcome !== "success"`. Free-form lowercase. */
  readonly errorCode?: string;
  readonly createdAt: Date;
}

/** Summary aggregate for a skill over a rolling window. */
export interface SkillAnalyticsSummary {
  readonly skillGuid: string;
  readonly window: "7d" | "30d" | "all";
  /** When set, the summary was computed only from events for this version. */
  readonly version?: string;
  readonly executionCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly timeoutCount: number;
  /** Success rate as a decimal in [0, 1]. `null` when `executionCount === 0`. */
  readonly successRate: number | null;
  readonly latencyMs: {
    readonly p50: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
  };
  readonly uniqueUsers: number;
  readonly topErrorCodes: ReadonlyArray<{ code: string; count: number }>;
}

/**
 * One row of `skill_pulls` — a record that a skill's package contents
 * were materialized somewhere (handed back via the JSON endpoint, the
 * detail page mint, or the playground sandbox load).
 *
 * The three sources answer different questions:
 *  - `api`        : someone (SDK / CLI / external agent) actually consumed the
 *                   skill programmatically. Closest to the north-star metric.
 *  - `web`        : someone opened the detail page; mostly exploration.
 *  - `playground` : the in-product trial path materialized the skill.
 */
export type PullSource = "api" | "web" | "playground";

export interface SkillPullEvent {
  readonly _id: string;
  readonly skillGuid: string;
  readonly skillName: string;
  readonly skillVersion: string;
  readonly userId: string;
  readonly source: PullSource;
  readonly createdAt: Date;
}

/** Granularity of a `pulls` time-series query. */
export type PullBucket = "hour" | "day" | "month";

/** One bucket of the pull time series. `bucket` is an ISO-8601 timestamp at the start of the window. */
export interface PullBucketCount {
  readonly bucket: string;
  readonly total: number;
  readonly bySource: Readonly<Record<PullSource, number>>;
}
