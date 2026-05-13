/**
 * In-process mirror reconcile scheduler.
 *
 * Replaces the k8s `CronJob` (`deployment/ornn-api/mirror-cronjob.yaml`,
 * removed in this PR) with an Agenda-backed scheduler that runs inside
 * the long-running `ornn-api` pod. Multi-pod-safe via Agenda's per-fire
 * row lock on the `agendaJobs` collection — exactly one pod claims each
 * scheduled fire, the rest skip; this is the same per-trigger DB lock
 * pattern Quartz/Hangfire use.
 *
 * Two recurring Agenda jobs are registered:
 *
 *   1. `mirror-reconcile` — the actual work. Schedule (cron string) is
 *      driven by `settings.mirror.reconcileSchedule`. Interpreted in
 *      `Asia/Singapore` (UTC+8, no DST) so admins typing `0 2 * * *`
 *      get literal 2am Singapore time. Empty schedule = unregistered
 *      (no scheduled fires; publish-time webhooks still work).
 *
 *   2. `mirror-sync-schedule` — runs every minute on every pod. Reads
 *      `settings.mirror.reconcileSchedule` from DB and (re-)registers
 *      `mirror-reconcile` via `agenda.every(cron, name, ...)`. Because
 *      `every()` is an upsert on the recurring-job doc keyed by name,
 *      all pods' Agenda instances converge on the new cadence via the
 *      shared `agendaJobs` collection — no cross-pod messaging needed,
 *      max ~65s lag from admin-save to effect.
 *
 * Crash recovery: `defaultLockLifetime` (10 min) means if a pod dies
 * mid-reconcile, the row's lock expires and another pod can re-claim.
 * `reconcileAll` is idempotent (diffs against current mirror tree),
 * so the worst case of two reconciles racing is a noisy tag-conflict
 * log entry — same gap the existing `POST /admin/mirror/reconcile`
 * route already accepts.
 *
 * @module domains/skills/mirror/scheduler
 */

import { Agenda } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";
import type { Db } from "mongodb";
import type pino from "pino";
import type { MirrorService } from "./mirrorService";
import type { SettingsService } from "../../settings/types";

const JOB_RECONCILE = "mirror-reconcile";
const JOB_SYNC_SCHEDULE = "mirror-sync-schedule";

/** Interpreted timezone for every cron expression we register. */
const DEFAULT_TIMEZONE = "Asia/Singapore";

/** Sync tick cadence — how often each pod re-reads settings. */
const DEFAULT_SYNC_INTERVAL = "1 minute";

/** Per-fire safety lock TTL. */
const DEFAULT_LOCK_LIFETIME_MS = 10 * 60 * 1000;

/** Agenda's internal poll cadence for the recurring-job table. */
const PROCESS_EVERY = "5 seconds";

export interface MirrorSchedulerDeps {
  /** Shared MongoDB connection — Agenda uses our existing client/pool. */
  db: Db;
  logger: pino.Logger;
  mirrorService: MirrorService;
  settingsService: SettingsService;
  /** Override the per-fire lock TTL (mostly for tests). */
  lockLifetimeMs?: number;
  /** Override the sync tick cadence (mostly for tests). */
  syncInterval?: string | number;
  /** Override the pinned cron timezone (mostly for tests). */
  timezone?: string;
  /** Override Agenda's internal poll cadence (mostly for tests). */
  processEvery?: string | number;
}

export interface MirrorScheduler {
  /** Spin up Agenda + register both jobs + kick off the first sync. */
  start(): Promise<void>;
  /** Stop Agenda's polling loop. Idempotent. */
  stop(): Promise<void>;
  /**
   * Test hook — force an immediate run of the sync tick instead of
   * waiting for the next minute. Returns once the tick completes.
   */
  runSyncNow(): Promise<void>;
}

export function createMirrorScheduler(deps: MirrorSchedulerDeps): MirrorScheduler {
  const { db, mirrorService, settingsService, logger } = deps;
  const lockLifetime = deps.lockLifetimeMs ?? DEFAULT_LOCK_LIFETIME_MS;
  const syncInterval = deps.syncInterval ?? DEFAULT_SYNC_INTERVAL;
  const timezone = deps.timezone ?? DEFAULT_TIMEZONE;

  const agenda = new Agenda({
    backend: new MongoBackend({ mongo: db }),
    processEvery: deps.processEvery ?? PROCESS_EVERY,
    defaultLockLifetime: lockLifetime,
  });

  // Per-process memo of the schedule we last registered with Agenda.
  // Lets the sync tick early-return when nothing changed, avoiding an
  // `every()` upsert each minute. NOT cross-pod; convergence still
  // happens via the shared `agendaJobs` doc.
  let currentSchedule: string | null = null;

  agenda.define(JOB_RECONCILE, async () => {
    const t0 = Date.now();
    try {
      const result = await mirrorService.reconcileAll();
      logger.info(
        { ...result, durationMs: Date.now() - t0 },
        "scheduled mirror reconcile completed",
      );
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - t0,
        },
        "scheduled mirror reconcile failed",
      );
      throw err;
    }
  });

  agenda.define(JOB_SYNC_SCHEDULE, async () => {
    let mirror;
    try {
      mirror = await settingsService.getMirror();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "mirror-sync-schedule: failed to read settings — skipping tick",
      );
      return;
    }
    const next = mirror.reconcileSchedule;
    if (next === currentSchedule) return;

    if (next === "") {
      await agenda.cancel({ name: JOB_RECONCILE });
      currentSchedule = "";
      logger.info(
        "mirror schedule: cancelled (settings.mirror.reconcileSchedule is empty)",
      );
      return;
    }

    try {
      await agenda.every(next, JOB_RECONCILE, undefined, { timezone });
      currentSchedule = next;
      logger.info({ cron: next, timezone }, "mirror schedule: registered");
    } catch (err) {
      // cron-parser already validated at settings-write time, so this
      // should only fire on an Agenda-internal failure (e.g., Mongo
      // unreachable mid-write). Log and try again next tick.
      logger.error(
        { err: err instanceof Error ? err.message : String(err), cron: next },
        "mirror schedule: failed to register — will retry on next sync tick",
      );
    }
  });

  // Surface Agenda's own error events so an internal Mongo hiccup is
  // visible in pod logs rather than swallowed.
  agenda.on("error", (err: unknown) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "agenda error event",
    );
  });

  return {
    async start() {
      await agenda.start();
      // Eager initial sync — don't wait a minute for the schedule to
      // come up after a fresh boot.
      try {
        await agenda.now(JOB_SYNC_SCHEDULE);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "mirror scheduler: initial sync enqueue failed — recurring sync will catch up",
        );
      }
      // Recurring sync tick. `every` upserts by job name, so this is
      // safe across multiple pods and across restarts.
      await agenda.every(syncInterval, JOB_SYNC_SCHEDULE);
      logger.info(
        { syncInterval, timezone, lockLifetimeMs: lockLifetime },
        "mirror scheduler started",
      );
    },
    async stop() {
      try {
        // `false` = don't close the Mongo client (we own it).
        await agenda.stop(false);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "mirror scheduler: agenda.stop failed — continuing",
        );
      }
    },
    async runSyncNow() {
      await agenda.now(JOB_SYNC_SCHEDULE);
    },
  };
}
