/**
 * Analytics repository — append-only event log + aggregation queries.
 *
 * One Mongo collection (`skill_executions`). Writes are fire-and-forget;
 * reads are per-skill aggregates over a rolling window.
 *
 * @module domains/analytics/repository
 */

import { randomUUID } from "node:crypto";
import type { Collection, Db, Document } from "mongodb";
import pino from "pino";
import type {
  ExecutionOutcome,
  SkillAnalyticsSummary,
  SkillExecutionEvent,
} from "./types";

const logger = pino({ level: "info" }).child({ module: "analyticsRepository" });

export interface RecordEventInput {
  skillGuid: string;
  skillName: string;
  skillVersion?: string;
  outcome: ExecutionOutcome;
  latencyMs: number;
  userId: string;
  source: SkillExecutionEvent["source"];
  errorCode?: string;
}

export class AnalyticsRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("skill_executions");
  }

  async ensureIndexes(): Promise<void> {
    try {
      await Promise.all([
        this.collection.createIndex({ skillGuid: 1, createdAt: -1 }),
        this.collection.createIndex({ createdAt: -1 }),
        this.collection.createIndex({ userId: 1 }),
      ]);
    } catch (err) {
      logger.error({ err }, "Failed to create skill_executions indexes");
    }
  }

  async recordEvent(input: RecordEventInput): Promise<void> {
    try {
      const doc: Document = {
        _id: randomUUID() as unknown as Document["_id"],
        skillGuid: input.skillGuid,
        skillName: input.skillName,
        skillVersion: input.skillVersion,
        outcome: input.outcome,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        userId: input.userId,
        source: input.source,
        errorCode: input.errorCode,
        createdAt: new Date(),
      };
      await this.collection.insertOne(doc);
    } catch (err) {
      // Analytics must never block a user's skill invocation — log and swallow.
      logger.warn({ err, skillGuid: input.skillGuid }, "Failed to record execution event");
    }
  }

  async summarize(
    skillGuid: string,
    window: "7d" | "30d" | "all",
    topErrorsLimit = 5,
  ): Promise<SkillAnalyticsSummary> {
    const now = new Date();
    const filter: Record<string, unknown> = { skillGuid };
    if (window !== "all") {
      const days = window === "7d" ? 7 : 30;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      filter.createdAt = { $gte: cutoff };
    }

    // One pass for counts + per-user dedup; a second pass for percentiles
    // to keep the aggregate shape simple + server-side computed.
    const countPipeline = [
      { $match: filter },
      {
        $group: {
          _id: null,
          executionCount: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ["$outcome", "success"] }, 1, 0] },
          },
          failureCount: {
            $sum: { $cond: [{ $eq: ["$outcome", "failure"] }, 1, 0] },
          },
          timeoutCount: {
            $sum: { $cond: [{ $eq: ["$outcome", "timeout"] }, 1, 0] },
          },
          uniqueUsers: { $addToSet: "$userId" },
        },
      },
      {
        $project: {
          _id: 0,
          executionCount: 1,
          successCount: 1,
          failureCount: 1,
          timeoutCount: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
        },
      },
    ];

    const percentilePipeline = [
      { $match: filter },
      {
        $group: {
          _id: null,
          latencies: { $push: "$latencyMs" },
        },
      },
    ];

    const errorsPipeline = [
      { $match: { ...filter, outcome: { $ne: "success" }, errorCode: { $ne: null } } },
      { $group: { _id: "$errorCode", count: { $sum: 1 } } },
      { $sort: { count: -1 as const } },
      { $limit: topErrorsLimit },
    ];

    const [countsRows, latencyRows, errorRows] = await Promise.all([
      this.collection.aggregate(countPipeline).toArray(),
      this.collection.aggregate(percentilePipeline).toArray(),
      this.collection.aggregate(errorsPipeline).toArray(),
    ]);

    const counts = (countsRows[0] ?? {
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      uniqueUsers: 0,
    }) as {
      executionCount: number;
      successCount: number;
      failureCount: number;
      timeoutCount: number;
      uniqueUsers: number;
    };

    const latencies = ((latencyRows[0]?.latencies as number[] | undefined) ?? []).sort(
      (a, b) => a - b,
    );
    const pick = (p: number): number | null => {
      if (latencies.length === 0) return null;
      const idx = Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length));
      return latencies[idx] ?? null;
    };

    const successRate =
      counts.executionCount > 0 ? counts.successCount / counts.executionCount : null;

    const topErrorCodes = errorRows.map((r) => ({
      code: String(r._id ?? ""),
      count: Number(r.count ?? 0),
    }));

    return {
      skillGuid,
      window,
      executionCount: counts.executionCount,
      successCount: counts.successCount,
      failureCount: counts.failureCount,
      timeoutCount: counts.timeoutCount,
      successRate,
      latencyMs: {
        p50: pick(50),
        p95: pick(95),
        p99: pick(99),
      },
      uniqueUsers: counts.uniqueUsers,
      topErrorCodes,
    };
  }
}
