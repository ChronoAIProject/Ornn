/**
 * In-process source-sync (drift-check) scheduler (#1176).
 *
 * Clones the mirror scheduler's multi-pod-safe Agenda pattern
 * (`domains/skills/mirror/scheduler.ts`): exactly one pod claims each
 * scheduled fire via Agenda's per-fire row lock on the `agendaJobs`
 * collection; the rest skip. Two recurring jobs:
 *
 *   1. `source-drift-check` — runs the drift batch job. Cadence (cron) is
 *      driven by `settings.sourceSync.pollSchedule`, interpreted in
 *      `Asia/Singapore`. Empty schedule = unregistered.
 *   2. `source-sync-schedule` — every minute on every pod, re-reads the
 *      cron from settings and (re-)registers the drift job via
 *      `agenda.every()`, so an admin cadence change converges cluster-wide
 *      within ~65s without cross-pod messaging.
 *
 * Crash recovery: `defaultLockLifetime` (10 min) lets another pod re-claim
 * a fire if the holder dies. The job itself is idempotent (it only records
 * drift state), so a rare double-run is harmless.
 *
 * @module domains/skills/crud/sourceSyncScheduler
 */
import { Agenda } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";
import type { Db } from "mongodb";
import type pino from "pino";
import type { SourceSyncSection } from "../../settings/sections/sourceSync";
import type { SourceDriftJobResult } from "./sourceDriftJob";

const JOB_DRIFT_CHECK = "source-drift-check";
const JOB_SYNC_SCHEDULE = "source-sync-schedule";

const DEFAULT_TIMEZONE = "Asia/Singapore";
const DEFAULT_SYNC_INTERVAL = "1 minute";
const DEFAULT_LOCK_LIFETIME_MS = 10 * 60 * 1000;
const PROCESS_EVERY = "5 seconds";

/** Narrow settings surface — just the source-sync section read. */
export interface SourceSyncSettingsReader {
  getSourceSync(): Promise<SourceSyncSection>;
}

export interface SourceSyncSchedulerDeps {
  db: Db;
  logger: pino.Logger;
  settingsService: SourceSyncSettingsReader;
  /** The actual work — constructed in bootstrap with the full job deps. */
  runDriftJob: () => Promise<SourceDriftJobResult>;
  lockLifetimeMs?: number;
  syncInterval?: string | number;
  timezone?: string;
  processEvery?: string | number;
}

export interface ScheduledRunStatus {
  status: "succeeded" | "failed" | "running" | "never_run";
  lastRunAt: Date | null;
  lastFinishedAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: Date | null;
}

export interface SourceSyncScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Test hook — force the sync tick immediately. */
  runSyncNow(): Promise<void>;
  getScheduledRunStatus(): Promise<ScheduledRunStatus>;
}

export function createSourceSyncScheduler(
  deps: SourceSyncSchedulerDeps,
): SourceSyncScheduler {
  const { db, settingsService, runDriftJob, logger } = deps;
  const lockLifetime = deps.lockLifetimeMs ?? DEFAULT_LOCK_LIFETIME_MS;
  const syncInterval = deps.syncInterval ?? DEFAULT_SYNC_INTERVAL;
  const timezone = deps.timezone ?? DEFAULT_TIMEZONE;

  const agenda = new Agenda({
    backend: new MongoBackend({ mongo: db }),
    processEvery: deps.processEvery ?? PROCESS_EVERY,
    defaultLockLifetime: lockLifetime,
  });

  // Per-process memo of the last-registered cron — lets the sync tick
  // early-return when nothing changed. Convergence across pods still
  // happens via the shared `agendaJobs` doc.
  let currentSchedule: string | null = null;

  agenda.define(JOB_DRIFT_CHECK, async () => {
    const t0 = Date.now();
    try {
      const result = await runDriftJob();
      logger.info(
        { ...result, durationMs: Date.now() - t0 },
        "scheduled source drift check completed",
      );
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        },
        "scheduled source drift check failed",
      );
      throw err;
    }
  });

  agenda.define(JOB_SYNC_SCHEDULE, async () => {
    let section: SourceSyncSection;
    try {
      section = await settingsService.getSourceSync();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "source-sync-schedule: failed to read settings — skipping tick",
      );
      return;
    }
    const next = section.pollSchedule;
    if (next === currentSchedule) return;

    if (next === "") {
      await agenda.cancel({ name: JOB_DRIFT_CHECK });
      currentSchedule = "";
      logger.info(
        "source-sync schedule: cancelled (settings.sourceSync.pollSchedule is empty)",
      );
      return;
    }

    try {
      await agenda.every(next, JOB_DRIFT_CHECK, undefined, { timezone });
      currentSchedule = next;
      logger.info({ cron: next, timezone }, "source-sync schedule: registered");
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), cron: next },
        "source-sync schedule: failed to register — will retry on next sync tick",
      );
    }
  });

  agenda.on("error", (err: unknown) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "agenda error event (source-sync)",
    );
  });

  return {
    async start() {
      await agenda.start();
      try {
        await agenda.now(JOB_SYNC_SCHEDULE);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "source-sync scheduler: initial sync enqueue failed — recurring sync will catch up",
        );
      }
      await agenda.every(syncInterval, JOB_SYNC_SCHEDULE);
      logger.info(
        { syncInterval, timezone, lockLifetimeMs: lockLifetime },
        "source-sync scheduler started",
      );
    },
    async stop() {
      try {
        await agenda.stop(false); // false = don't close the Mongo client (we own it)
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "source-sync scheduler: agenda.stop failed — continuing",
        );
      }
    },
    async runSyncNow() {
      await agenda.now(JOB_SYNC_SCHEDULE);
    },
    async getScheduledRunStatus(): Promise<ScheduledRunStatus> {
      let result;
      try {
        result = await agenda.queryJobs({ name: JOB_DRIFT_CHECK });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "getScheduledRunStatus (source-sync): queryJobs failed — returning never_run",
        );
        return emptyStatus();
      }
      const job = result.jobs[0];
      if (!job) return emptyStatus();

      const lastRunAt = job.lastRunAt ?? null;
      const lastFinishedAt = job.lastFinishedAt ?? null;
      const failedAt = job.failedAt ?? null;
      const lockedAt = job.lockedAt ?? null;

      let status: ScheduledRunStatus["status"];
      if (lockedAt) {
        status = "running";
      } else if (
        failedAt &&
        (!lastFinishedAt || failedAt.getTime() >= lastFinishedAt.getTime())
      ) {
        status = "failed";
      } else if (lastFinishedAt) {
        status = "succeeded";
      } else {
        status = "never_run";
      }

      const lastDurationMs =
        lastFinishedAt && lastRunAt
          ? lastFinishedAt.getTime() - lastRunAt.getTime()
          : null;

      return {
        status,
        lastRunAt,
        lastFinishedAt,
        lastDurationMs,
        lastError: status === "failed" ? (job.failReason ?? null) : null,
        nextRunAt: job.nextRunAt ?? null,
      };
    },
  };
}

function emptyStatus(): ScheduledRunStatus {
  return {
    status: "never_run",
    lastRunAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: null,
    nextRunAt: null,
  };
}
