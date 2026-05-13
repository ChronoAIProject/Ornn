/**
 * Mirror scheduler unit tests.
 *
 * These tests focus on our wiring of Agenda — *what we ask Agenda to
 * do* on every sync tick — not on Agenda's internal job-running
 * machinery, which is Agenda's own test suite's job. We mock the
 * Agenda surface so the assertions stay deterministic and fast.
 *
 * The multipod safety claim (only one pod fires per cron tick) is a
 * property of Agenda's per-fire row lock — verified upstream in the
 * `agenda` package's tests, not duplicated here.
 *
 * @module domains/skills/mirror/scheduler.test
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import pino from "pino";
import type { MirrorService } from "./mirrorService";
import type { SettingsService } from "../../settings/types";
import type { MirrorSection } from "../../settings/sections/mirror";

const logger = pino({ level: "silent" });

// Module-level mutable refs that the mocked Agenda instance reads. Each
// test resets them in beforeEach.
let agendaCalls: {
  define: Array<{ name: string }>;
  every: Array<{ interval: string | number; name: string; options?: { timezone?: string } }>;
  cancel: Array<{ name?: string }>;
  now: string[];
  started: boolean;
  stopped: boolean;
};
const jobHandlers = new Map<string, () => Promise<void>>();

// Mutable canned `queryJobs` result — tests set this per case.
let queryJobsResult: { jobs: Array<Record<string, unknown>> } = { jobs: [] };
let queryJobsThrows: Error | null = null;

// Mock the `agenda` + `@agendajs/mongo-backend` modules BEFORE the
// scheduler module is imported. We re-import the scheduler in each
// test via dynamic `import()` to ensure it picks up the mocks.
mock.module("agenda", () => ({
  Agenda: class FakeAgenda {
    on() {}
    define(name: string, fn: () => Promise<void>) {
      agendaCalls.define.push({ name });
      jobHandlers.set(name, fn);
    }
    async every(
      interval: string | number,
      name: string,
      _data: unknown,
      options?: { timezone?: string },
    ) {
      agendaCalls.every.push({ interval, name, options });
    }
    async cancel(opts: { name?: string }) {
      agendaCalls.cancel.push(opts);
      return 1;
    }
    async now(name: string) {
      agendaCalls.now.push(name);
      // Execute the handler synchronously so tests can assert on the
      // resulting `every`/`cancel` calls immediately. Mirrors the
      // production sequence: enqueued one-shot → handler runs → may
      // call `every` to register the recurring job.
      const fn = jobHandlers.get(name);
      if (fn) await fn();
    }
    async start() {
      agendaCalls.started = true;
    }
    async stop() {
      agendaCalls.stopped = true;
    }
    async queryJobs(_opts: { name: string }) {
      if (queryJobsThrows) throw queryJobsThrows;
      return queryJobsResult;
    }
  },
}));
mock.module("@agendajs/mongo-backend", () => ({
  MongoBackend: class FakeBackend {
    constructor(_: unknown) {}
  },
}));

// Lazy-load the scheduler module AFTER mocks are set up.
const { createMirrorScheduler } = await import("./scheduler");

function resetAgendaCalls() {
  agendaCalls = {
    define: [],
    every: [],
    cancel: [],
    now: [],
    started: false,
    stopped: false,
  };
  jobHandlers.clear();
  queryJobsResult = { jobs: [] };
  queryJobsThrows = null;
}

function makeSettings(initial: string): SettingsService & {
  setSchedule(s: string): void;
} {
  let cur: MirrorSection = {
    enabled: true,
    owner: "o",
    repo: "r",
    branch: "main",
    appId: "1",
    installationId: "2",
    appPrivateKey: "k",
    reconcileSchedule: initial,
  };
  return {
    getMirror: mock(async () => cur),
    setSchedule(next: string) {
      cur = { ...cur, reconcileSchedule: next };
    },
  } as unknown as SettingsService & { setSchedule(s: string): void };
}

function makeMirrorService(): MirrorService {
  return {
    reconcileAll: mock(async () => ({ added: 0, updated: 0, removed: 0, unchanged: 0 })),
  } as unknown as MirrorService;
}

const FAKE_DB = {} as Parameters<typeof createMirrorScheduler>[0]["db"];

beforeEach(() => {
  resetAgendaCalls();
});

afterEach(async () => {
  // every test stops the scheduler explicitly, but be defensive.
});

describe("createMirrorScheduler", () => {
  test("on start, registers both jobs + eager-syncs schedule from settings (SGT)", async () => {
    const settings = makeSettings("0 2 * * *");
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: settings,
    });
    await sched.start();

    // Both jobs defined
    expect(agendaCalls.define.map((d) => d.name).sort()).toEqual([
      "mirror-reconcile",
      "mirror-sync-schedule",
    ]);

    // Eager `agenda.now("mirror-sync-schedule")` ran during start, which
    // in turn called `agenda.every("0 2 * * *", "mirror-reconcile",
    // ..., { timezone: "Asia/Singapore" })`.
    const everyReconcile = agendaCalls.every.find(
      (e) => e.name === "mirror-reconcile",
    );
    expect(everyReconcile).toBeDefined();
    expect(everyReconcile!.interval).toBe("0 2 * * *");
    expect(everyReconcile!.options?.timezone).toBe("Asia/Singapore");

    // Recurring sync tick registered.
    const everySync = agendaCalls.every.find(
      (e) => e.name === "mirror-sync-schedule",
    );
    expect(everySync).toBeDefined();
    expect(everySync!.interval).toBe("1 minute");

    await sched.stop();
    expect(agendaCalls.stopped).toBe(true);
  });

  test("settings change → next sync tick re-registers with new cron, no spurious calls", async () => {
    const settings = makeSettings("0 2 * * *");
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: settings,
    });
    await sched.start();

    const beforeChange = agendaCalls.every.filter(
      (e) => e.name === "mirror-reconcile",
    ).length;

    // Admin saves new cron
    settings.setSchedule("*/30 * * * *");
    await sched.runSyncNow();

    const afterChange = agendaCalls.every.filter(
      (e) => e.name === "mirror-reconcile",
    );
    expect(afterChange.length).toBe(beforeChange + 1);
    expect(afterChange.at(-1)!.interval).toBe("*/30 * * * *");
    expect(afterChange.at(-1)!.options?.timezone).toBe("Asia/Singapore");

    await sched.stop();
  });

  test("unchanged schedule on subsequent sync → no second every() call", async () => {
    const settings = makeSettings("0 2 * * *");
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: settings,
    });
    await sched.start();
    const baseline = agendaCalls.every.filter(
      (e) => e.name === "mirror-reconcile",
    ).length;

    // Two more sync ticks with the SAME schedule — should be no-ops.
    await sched.runSyncNow();
    await sched.runSyncNow();

    const after = agendaCalls.every.filter(
      (e) => e.name === "mirror-reconcile",
    ).length;
    expect(after).toBe(baseline);

    await sched.stop();
  });

  test("empty schedule → cancels recurring job", async () => {
    const settings = makeSettings("0 2 * * *");
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: settings,
    });
    await sched.start();

    settings.setSchedule("");
    await sched.runSyncNow();

    const cancels = agendaCalls.cancel.filter(
      (c) => c.name === "mirror-reconcile",
    );
    expect(cancels.length).toBe(1);

    // Re-enable
    settings.setSchedule("0 3 * * *");
    await sched.runSyncNow();
    const everyReconcile = agendaCalls.every.filter(
      (e) => e.name === "mirror-reconcile",
    );
    expect(everyReconcile.at(-1)!.interval).toBe("0 3 * * *");

    await sched.stop();
  });

  test("mirror-reconcile handler delegates to MirrorService.reconcileAll", async () => {
    const settings = makeSettings("0 2 * * *");
    const mirror = makeMirrorService();
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: mirror,
      settingsService: settings,
    });
    await sched.start();

    // The fake Agenda recorded the defined handler — call it.
    const fn = jobHandlers.get("mirror-reconcile");
    expect(fn).toBeDefined();
    await fn!();
    expect((mirror.reconcileAll as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);

    await sched.stop();
  });

  test("settings read failure on sync tick is swallowed (no crash)", async () => {
    const broken = {
      getMirror: mock(async () => {
        throw new Error("db down");
      }),
    } as unknown as SettingsService;
    const sched = createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: broken,
    });
    // Start must not throw even though the eager initial sync hits the
    // broken settings read.
    await sched.start();
    // And another sync tick should also be tolerated.
    await sched.runSyncNow();
    await sched.stop();
  });
});

describe("MirrorScheduler.getScheduledRunStatus", () => {
  function makeScheduler() {
    return createMirrorScheduler({
      db: FAKE_DB,
      logger,
      mirrorService: makeMirrorService(),
      settingsService: makeSettings("0 2 * * *"),
    });
  }

  test("never_run when no agendaJobs doc exists yet", async () => {
    queryJobsResult = { jobs: [] };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("never_run");
    expect(s.lastRunAt).toBeNull();
    expect(s.lastFinishedAt).toBeNull();
    expect(s.lastDurationMs).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.nextRunAt).toBeNull();
    await sched.stop();
  });

  test("succeeded when lastFinishedAt set and no recent failure", async () => {
    const lastRunAt = new Date("2026-05-13T18:00:00.000Z");
    const lastFinishedAt = new Date("2026-05-13T18:00:04.213Z");
    const nextRunAt = new Date("2026-05-14T18:00:00.000Z");
    queryJobsResult = {
      jobs: [{ lastRunAt, lastFinishedAt, nextRunAt }],
    };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("succeeded");
    expect(s.lastRunAt?.toISOString()).toBe(lastRunAt.toISOString());
    expect(s.lastFinishedAt?.toISOString()).toBe(lastFinishedAt.toISOString());
    expect(s.lastDurationMs).toBe(4213);
    expect(s.lastError).toBeNull();
    expect(s.nextRunAt?.toISOString()).toBe(nextRunAt.toISOString());
    await sched.stop();
  });

  test("failed when failedAt is the most recent terminal stamp", async () => {
    const lastRunAt = new Date("2026-05-13T18:00:00.000Z");
    const lastFinishedAt = new Date("2026-05-13T17:00:01.000Z"); // older
    const failedAt = new Date("2026-05-13T18:00:02.000Z"); // newer than lastFinishedAt
    queryJobsResult = {
      jobs: [
        {
          lastRunAt,
          lastFinishedAt,
          failedAt,
          failReason: "github 502: Bad Gateway",
        },
      ],
    };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("failed");
    expect(s.lastError).toBe("github 502: Bad Gateway");
    await sched.stop();
  });

  test("failed when failedAt set and lastFinishedAt never set", async () => {
    const lastRunAt = new Date("2026-05-13T18:00:00.000Z");
    const failedAt = new Date("2026-05-13T18:00:02.000Z");
    queryJobsResult = {
      jobs: [{ lastRunAt, failedAt, failReason: "boom" }],
    };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("failed");
    expect(s.lastError).toBe("boom");
    await sched.stop();
  });

  test("running when lockedAt is set (regardless of other stamps)", async () => {
    queryJobsResult = {
      jobs: [
        {
          lastRunAt: new Date("2026-05-13T18:00:00.000Z"),
          lockedAt: new Date("2026-05-14T18:00:00.000Z"),
          // Even a stale failedAt doesn't override `running`.
          failedAt: new Date("2026-05-13T18:01:00.000Z"),
          failReason: "old failure",
        },
      ],
    };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("running");
    expect(s.lastError).toBeNull();
    await sched.stop();
  });

  test("lastDurationMs is null when only lastRunAt set (mid-flight, no finish yet)", async () => {
    queryJobsResult = {
      jobs: [
        {
          lastRunAt: new Date("2026-05-13T18:00:00.000Z"),
          lockedAt: new Date("2026-05-13T18:00:00.000Z"),
        },
      ],
    };
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.lastDurationMs).toBeNull();
    await sched.stop();
  });

  test("queryJobs throw → returns never_run, doesn't propagate", async () => {
    queryJobsThrows = new Error("mongo unreachable");
    const sched = makeScheduler();
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("never_run");
    await sched.stop();
  });
});
