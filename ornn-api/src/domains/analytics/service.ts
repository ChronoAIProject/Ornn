/**
 * Analytics service — thin facade over the repo.
 *
 * - `recordExecution` is callable from any hook that knows the skill +
 *   outcome (today: playground chat). Fire-and-forget, never throws.
 * - `recordPull` is called from every endpoint that materializes a skill
 *   package — `/skills/:idOrName` (web), `/skills/:idOrName/json` (api),
 *   the playground load (playground). Fire-and-forget.
 * - `getSummary` reads the execution aggregate windowed by 7d / 30d / all,
 *   optionally narrowed to a single version.
 * - `getPullsTimeSeries` returns the bucketed pull counts that drive the
 *   usage chart on `SkillDetailPage`.
 *
 * @module domains/analytics/service
 */

import type {
  AggregatePullsParams,
  AnalyticsRepository,
  RecordEventInput,
  RecordPullInput,
} from "./repository";
import type { PullBucketCount, SkillAnalyticsSummary } from "./types";

export interface AnalyticsServiceDeps {
  readonly analyticsRepo: AnalyticsRepository;
}

export class AnalyticsService {
  private readonly repo: AnalyticsRepository;

  constructor(deps: AnalyticsServiceDeps) {
    this.repo = deps.analyticsRepo;
  }

  async recordExecution(input: RecordEventInput): Promise<void> {
    return this.repo.recordEvent(input);
  }

  async recordPull(input: RecordPullInput): Promise<void> {
    return this.repo.recordPull(input);
  }

  async getSummary(
    skillGuid: string,
    window: "7d" | "30d" | "all" = "30d",
    version?: string,
  ): Promise<SkillAnalyticsSummary> {
    return this.repo.summarize(skillGuid, window, { version });
  }

  async getPullsTimeSeries(
    params: AggregatePullsParams,
  ): Promise<ReadonlyArray<PullBucketCount>> {
    return this.repo.aggregatePullsByBucket(params);
  }
}
