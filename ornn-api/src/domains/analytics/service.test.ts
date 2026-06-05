/**
 * Unit tests for `AnalyticsService` (#880).
 *
 * The service is a thin facade over `AnalyticsRepository`: every method
 * forwards to the repo. These tests pin the forwarding contract with a
 * hand-rolled `FakeAnalyticsRepository` (no Mongo) and assert the EXACT
 * arguments handed to each repo method — in particular the
 * `exactOptionalPropertyTypes` arm in `getSummary` (service.ts:50), where
 * a present `version` forwards `{ version }` and an absent one forwards
 * `{}` rather than `{ version: undefined }`.
 *
 * @module domains/analytics/service.test
 */

import { describe, expect, it } from "bun:test";
import { AnalyticsService } from "./service";
import type {
  AggregatePullsParams,
  RecordEventInput,
  RecordPullInput,
} from "./repository";
import type { PullBucketCount, SkillAnalyticsSummary } from "./types";

// ---- Fixtures --------------------------------------------------------

function summary(overrides: Partial<SkillAnalyticsSummary> = {}): SkillAnalyticsSummary {
  return {
    skillGuid: "skill-guid-1",
    window: "30d",
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    successRate: null,
    latencyMs: { p50: null, p95: null, p99: null },
    uniqueUsers: 0,
    topErrorCodes: [],
    ...overrides,
  };
}

function eventInput(overrides: Partial<RecordEventInput> = {}): RecordEventInput {
  return {
    skillGuid: "skill-guid-1",
    skillName: "demo-skill",
    outcome: "success",
    latencyMs: 42,
    userId: "user-1",
    source: "playground",
    ...overrides,
  };
}

function pullInput(overrides: Partial<RecordPullInput> = {}): RecordPullInput {
  return {
    skillGuid: "skill-guid-1",
    skillName: "demo-skill",
    skillVersion: "1.0.0",
    userId: "user-1",
    source: "api",
    ...overrides,
  };
}

// ---- Fake repo -------------------------------------------------------

/** Records every call's args so the test can assert exact forwarding. */
class FakeAnalyticsRepository {
  recordEventCalls: RecordEventInput[] = [];
  recordPullCalls: RecordPullInput[] = [];
  summarizeCalls: Array<{
    skillGuid: string;
    window: "7d" | "30d" | "all";
    options: { version?: string; topErrorsLimit?: number };
  }> = [];
  aggregateCalls: AggregatePullsParams[] = [];

  summarizeResult: SkillAnalyticsSummary = summary();
  aggregateResult: ReadonlyArray<PullBucketCount> = [];

  async recordEvent(input: RecordEventInput): Promise<void> {
    this.recordEventCalls.push(input);
  }
  async recordPull(input: RecordPullInput): Promise<void> {
    this.recordPullCalls.push(input);
  }
  async summarize(
    skillGuid: string,
    window: "7d" | "30d" | "all",
    options: { version?: string; topErrorsLimit?: number } = {},
  ): Promise<SkillAnalyticsSummary> {
    this.summarizeCalls.push({ skillGuid, window, options });
    return this.summarizeResult;
  }
  async aggregatePullsByBucket(
    params: AggregatePullsParams,
  ): Promise<ReadonlyArray<PullBucketCount>> {
    this.aggregateCalls.push(params);
    return this.aggregateResult;
  }
}

function build(): { service: AnalyticsService; repo: FakeAnalyticsRepository } {
  const repo = new FakeAnalyticsRepository();
  const service = new AnalyticsService({
    analyticsRepo: repo as unknown as ConstructorParameters<
      typeof AnalyticsService
    >[0]["analyticsRepo"],
  });
  return { service, repo };
}

// ---- recordExecution -------------------------------------------------

describe("AnalyticsService.recordExecution", () => {
  it("forwards the event input verbatim to repo.recordEvent", async () => {
    const { service, repo } = build();
    const input = eventInput({ outcome: "failure", errorCode: "boom" });

    await service.recordExecution(input);

    expect(repo.recordEventCalls).toHaveLength(1);
    expect(repo.recordEventCalls[0]).toEqual(input);
    expect(repo.recordPullCalls).toHaveLength(0);
  });
});

// ---- recordPull ------------------------------------------------------

describe("AnalyticsService.recordPull", () => {
  it("forwards the pull input verbatim to repo.recordPull", async () => {
    const { service, repo } = build();
    const input = pullInput({ source: "web" });

    await service.recordPull(input);

    expect(repo.recordPullCalls).toHaveLength(1);
    expect(repo.recordPullCalls[0]).toEqual(input);
    expect(repo.recordEventCalls).toHaveLength(0);
  });
});

// ---- getSummary ------------------------------------------------------

describe("AnalyticsService.getSummary", () => {
  it("defaults the window to 30d and forwards an empty options object", async () => {
    const { service, repo } = build();

    await service.getSummary("skill-guid-1");

    expect(repo.summarizeCalls).toHaveLength(1);
    expect(repo.summarizeCalls[0]!.window).toBe("30d");
    // exactOptionalPropertyTypes (service.ts:50): absent version → `{}`,
    // NOT `{ version: undefined }`.
    expect(repo.summarizeCalls[0]!.options).toEqual({});
    expect("version" in repo.summarizeCalls[0]!.options).toBe(false);
  });

  it("forwards an explicit window through to the repo", async () => {
    const { service, repo } = build();

    await service.getSummary("skill-guid-1", "7d");

    expect(repo.summarizeCalls[0]!.window).toBe("7d");
  });

  it("forwards { version } when a version is provided", async () => {
    const { service, repo } = build();

    await service.getSummary("skill-guid-1", "all", "2.1.0");

    expect(repo.summarizeCalls[0]!.skillGuid).toBe("skill-guid-1");
    expect(repo.summarizeCalls[0]!.window).toBe("all");
    expect(repo.summarizeCalls[0]!.options).toEqual({ version: "2.1.0" });
  });

  it("returns the repo's summary unchanged", async () => {
    const { service, repo } = build();
    repo.summarizeResult = summary({ executionCount: 7, window: "7d" });

    const result = await service.getSummary("skill-guid-1", "7d");

    expect(result).toBe(repo.summarizeResult);
    expect(result.executionCount).toBe(7);
  });
});

// ---- getPullsTimeSeries ----------------------------------------------

describe("AnalyticsService.getPullsTimeSeries", () => {
  it("forwards the params verbatim to repo.aggregatePullsByBucket", async () => {
    const { service, repo } = build();
    const params: AggregatePullsParams = {
      skillGuid: "skill-guid-1",
      bucket: "day",
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-02-01T00:00:00Z"),
      version: "1.0.0",
    };

    await service.getPullsTimeSeries(params);

    expect(repo.aggregateCalls).toHaveLength(1);
    expect(repo.aggregateCalls[0]).toEqual(params);
  });

  it("returns the repo's bucket rows unchanged", async () => {
    const { service, repo } = build();
    repo.aggregateResult = [
      { bucket: "2026-01-01T00:00:00.000Z", total: 3, bySource: { api: 3, web: 0, playground: 0 } },
    ];

    const result = await service.getPullsTimeSeries({ skillGuid: "skill-guid-1", bucket: "day" });

    expect(result).toBe(repo.aggregateResult);
    expect(result).toHaveLength(1);
  });
});
