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
