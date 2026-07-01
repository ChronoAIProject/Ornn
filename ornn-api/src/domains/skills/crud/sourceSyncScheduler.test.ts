/**
 * Source-sync scheduler unit tests. Mocks the Agenda surface (same approach
 * as the mirror scheduler test) so assertions stay deterministic — the
 * multi-pod row-lock guarantee is Agenda's own to test, not ours.
 *
 * @module domains/skills/crud/sourceSyncScheduler.test
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import pino from "pino";
import type { SourceSyncSettingsReader } from "./sourceSyncScheduler";
import type { SourceSyncSection } from "../../settings/sections/sourceSync";
import type { SourceDriftJobResult } from "./sourceDriftJob";

const logger = pino({ level: "silent" });

let agendaCalls: {
  define: Array<{ name: string }>;
  every: Array<{ interval: string | number; name: string; options?: { timezone?: string } }>;
  cancel: Array<{ name?: string }>;
  now: string[];
  started: boolean;
  stopped: boolean;
};
const jobHandlers = new Map<string, () => Promise<void>>();
let queryJobsResult: { jobs: Array<Record<string, unknown>> } = { jobs: [] };
let queryJobsThrows: Error | null = null;

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
      agendaCalls.every.push({ interval, name, ...(options !== undefined ? { options } : {}) });
    }
    async cancel(opts: { name?: string }) {
      agendaCalls.cancel.push(opts);
      return 1;
    }
    async now(name: string) {
      agendaCalls.now.push(name);
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

const { createSourceSyncScheduler } = await import("./sourceSyncScheduler");

function resetAgendaCalls() {
  agendaCalls = { define: [], every: [], cancel: [], now: [], started: false, stopped: false };
  jobHandlers.clear();
  queryJobsResult = { jobs: [] };
  queryJobsThrows = null;
}

function makeSettings(initial: string): SourceSyncSettingsReader & { set(s: string): void } {
  let cur: SourceSyncSection = {
    enabled: true,
    githubToken: "",
    pollSchedule: initial,
    minCheckIntervalMinutes: 60,
    autoPublish: false,
  };
  return {
    getSourceSync: mock(async () => cur),
    set(next: string) {
      cur = { ...cur, pollSchedule: next };
    },
  } as unknown as SourceSyncSettingsReader & { set(s: string): void };
}

const okResult: SourceDriftJobResult = {
  enabled: true,
  groups: 0,
  checked: 0,
  drifted: 0,
  broken: 0,
  skipped: 0,
  autoPublished: 0,
  autoSyncFailed: 0,
};
const FAKE_DB = {} as Parameters<typeof createSourceSyncScheduler>[0]["db"];

beforeEach(() => {
  resetAgendaCalls();
});

describe("createSourceSyncScheduler", () => {
  test("start registers both jobs + eager-syncs schedule from settings (SGT)", async () => {
    const settings = makeSettings("*/15 * * * *");
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: settings,
      runDriftJob: async () => okResult,
    });
    await sched.start();

    expect(agendaCalls.define.map((d) => d.name).sort()).toEqual([
      "source-drift-check",
      "source-sync-schedule",
    ]);
    const everyJob = agendaCalls.every.find((e) => e.name === "source-drift-check");
    expect(everyJob).toBeDefined();
    expect(everyJob!.interval).toBe("*/15 * * * *");
    expect(everyJob!.options?.timezone).toBe("Asia/Singapore");
    const everySync = agendaCalls.every.find((e) => e.name === "source-sync-schedule");
    expect(everySync!.interval).toBe("1 minute");

    await sched.stop();
    expect(agendaCalls.stopped).toBe(true);
  });

  test("settings change → next tick re-registers with new cron", async () => {
    const settings = makeSettings("*/15 * * * *");
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: settings,
      runDriftJob: async () => okResult,
    });
    await sched.start();
    const before = agendaCalls.every.filter((e) => e.name === "source-drift-check").length;

    settings.set("0 * * * *");
    await sched.runSyncNow();

    const after = agendaCalls.every.filter((e) => e.name === "source-drift-check");
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.interval).toBe("0 * * * *");
  });

  test("unchanged schedule → no second every() for the job", async () => {
    const settings = makeSettings("*/15 * * * *");
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: settings,
      runDriftJob: async () => okResult,
    });
    await sched.start();
    const baseline = agendaCalls.every.filter((e) => e.name === "source-drift-check").length;
    await sched.runSyncNow();
    await sched.runSyncNow();
    expect(agendaCalls.every.filter((e) => e.name === "source-drift-check").length).toBe(baseline);
  });

  test("empty schedule → cancels the recurring job; re-enabling re-registers", async () => {
    const settings = makeSettings("*/15 * * * *");
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: settings,
      runDriftJob: async () => okResult,
    });
    await sched.start();

    settings.set("");
    await sched.runSyncNow();
    expect(agendaCalls.cancel.filter((c) => c.name === "source-drift-check").length).toBe(1);

    settings.set("0 3 * * *");
    await sched.runSyncNow();
    expect(
      agendaCalls.every.filter((e) => e.name === "source-drift-check").at(-1)!.interval,
    ).toBe("0 3 * * *");
  });

  test("drift-check handler delegates to runDriftJob", async () => {
    let ran = 0;
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: makeSettings("*/15 * * * *"),
      runDriftJob: async () => {
        ran++;
        return okResult;
      },
    });
    await sched.start();
    const fn = jobHandlers.get("source-drift-check");
    expect(fn).toBeDefined();
    await fn!();
    expect(ran).toBe(1);
  });

  test("settings read failure on a tick is swallowed (no crash)", async () => {
    const broken = {
      getSourceSync: mock(async () => {
        throw new Error("db down");
      }),
    } as unknown as SourceSyncSettingsReader;
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: broken,
      runDriftJob: async () => okResult,
    });
    await sched.start(); // eager sync hits the broken read but must not throw
    await sched.runSyncNow();
    await sched.stop();
  });

  test("getScheduledRunStatus: succeeded derivation", async () => {
    const lastRunAt = new Date("2026-07-01T02:00:00.000Z");
    const lastFinishedAt = new Date("2026-07-01T02:00:03.500Z");
    queryJobsResult = { jobs: [{ lastRunAt, lastFinishedAt }] };
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: makeSettings("*/15 * * * *"),
      runDriftJob: async () => okResult,
    });
    await sched.start();
    const s = await sched.getScheduledRunStatus();
    expect(s.status).toBe("succeeded");
    expect(s.lastDurationMs).toBe(3500);
  });

  test("getScheduledRunStatus: queryJobs throw → never_run", async () => {
    queryJobsThrows = new Error("mongo unreachable");
    const sched = createSourceSyncScheduler({
      db: FAKE_DB,
      logger,
      settingsService: makeSettings("*/15 * * * *"),
      runDriftJob: async () => okResult,
    });
    await sched.start();
    expect((await sched.getScheduledRunStatus()).status).toBe("never_run");
  });
});
