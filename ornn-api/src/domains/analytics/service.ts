/**
 * Analytics service — thin facade over the repo.
 *
 * - `recordExecution` is callable from any hook that knows the skill +
 *   outcome (today: playground chat). Fire-and-forget, never throws.
 * - `getSummary` reads the aggregate windowed by 7d / 30d / all.
 *
 * @module domains/analytics/service
 */

import type { AnalyticsRepository, RecordEventInput } from "./repository";
import type { SkillAnalyticsSummary } from "./types";

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

  async getSummary(
    skillGuid: string,
    window: "7d" | "30d" | "all" = "30d",
  ): Promise<SkillAnalyticsSummary> {
    return this.repo.summarize(skillGuid, window);
  }
}
