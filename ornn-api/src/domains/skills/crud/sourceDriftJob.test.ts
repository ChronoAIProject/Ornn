import { describe, expect, test } from "bun:test";
import pino from "pino";
import { runSourceDriftJob, type SourceDriftJobDeps } from "./sourceDriftJob";
import {
  GitHubSourceNotFoundError,
  GitHubRateLimitError,
  type RefHeadProbeInput,
  type RefHeadProbeResult,
} from "./utils/githubPull";
import type { AutoPublishOutcome } from "./sourceDrift";
import type { SkillSource } from "../../../shared/types/index";

const logger = pino({ level: "silent" });

type Candidate = { guid: string; source: SkillSource; ownerId: string };
type Probe = (
  repo: string,
  ref: string,
  opts?: RefHeadProbeInput,
) => Promise<RefHeadProbeResult>;

function cand(
  guid: string,
  repo: string,
  ref: string,
  sourceExtra: Partial<Extract<SkillSource, { type: "github" }>> = {},
): Candidate {
  return {
    guid,
    ownerId: `owner-${guid}`,
    source: { type: "github", repo, ref, path: "", ...sourceExtra },
  };
}

function makeDeps(opts: {
  enabled?: boolean;
  candidates: Candidate[];
  probe: Probe;
  concurrency?: number;
  autoPublishSetting?: boolean;
  autoPublish?: (guid: string) => Promise<AutoPublishOutcome>;
}): {
  deps: SourceDriftJobDeps;
  persisted: Array<{ guid: string; patch: Record<string, unknown> }>;
  notified: Array<{ ownerId: string; skillGuid: string; repo: string; ref: string }>;
  autoSynced: Array<{ skillGuid: string; fromVersion: string; toVersion: string }>;
  autoFailed: Array<{ skillGuid: string; reason: string }>;
  activity: Array<{ action: string; properties: Record<string, unknown> }>;
} {
  const persisted: Array<{ guid: string; patch: Record<string, unknown> }> = [];
  const notified: Array<{ ownerId: string; skillGuid: string; repo: string; ref: string }> = [];
  const autoSynced: Array<{ skillGuid: string; fromVersion: string; toVersion: string }> = [];
  const autoFailed: Array<{ skillGuid: string; reason: string }> = [];
  const activity: Array<{ action: string; properties: Record<string, unknown> }> = [];
  const deps: SourceDriftJobDeps = {
    skillRepo: {
      findGithubSourcedSkills: async () => opts.candidates,
      updateSourceDriftState: async (guid, patch) => {
        persisted.push({ guid, patch: patch as Record<string, unknown> });
      },
    },
    settingsService: {
      getSourceSync: async () => ({
        enabled: opts.enabled ?? true,
        githubToken: "tok",
        pollSchedule: "*/15 * * * *",
        minCheckIntervalMinutes: 60,
        autoPublish: opts.autoPublishSetting ?? false,
      }),
    },
    notifier: {
      notifySourceBroken: async (p) => {
        notified.push(p);
      },
      notifyAutoSynced: async (p) => {
        autoSynced.push({ skillGuid: p.skillGuid, fromVersion: p.fromVersion, toVersion: p.toVersion });
      },
      notifyAutoSyncFailed: async (p) => {
        autoFailed.push({ skillGuid: p.skillGuid, reason: p.reason });
      },
    },
    analyticsEmitter: {
      trackPlatformActivity: (input) => {
        activity.push({ action: input.action, properties: input.properties ?? {} });
      },
    },
    logger,
    probeRefHead: opts.probe,
    ...(opts.autoPublish ? { autoPublish: opts.autoPublish } : {}),
    concurrency: opts.concurrency ?? 5,
    jitterMs: 0,
  };
  return { deps, persisted, notified, autoSynced, autoFailed, activity };
}

describe("runSourceDriftJob", () => {
  test("disabled settings → no-op (no probe, no persist)", async () => {
    let probed = 0;
    const { deps, persisted } = makeDeps({
      enabled: false,
      candidates: [cand("g1", "acme/x", "main")],
      probe: async () => {
        probed++;
        return { sha: "s", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(res.enabled).toBe(false);
    expect(probed).toBe(0);
    expect(persisted.length).toBe(0);
  });

  test("coalesces by (repo,ref): N skills sharing an upstream → ONE probe", async () => {
    let probes = 0;
    const { deps, persisted, notified } = makeDeps({
      candidates: [
        cand("g1", "acme/x", "main", { lastSyncedCommit: "c1" }),
        cand("g2", "acme/x", "main", { lastSyncedCommit: "c1" }),
        cand("g3", "acme/x", "main", { lastSyncedCommit: "cOLD" }),
      ],
      probe: async () => {
        probes++;
        return { sha: "c1", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(probes).toBe(1); // one probe for the shared (repo,ref)
    expect(res.groups).toBe(1);
    expect(res.checked).toBe(3); // fanned out to all three
    expect(res.drifted).toBe(1); // only g3's lastSyncedCommit differs
    expect(persisted.length).toBe(3);
    expect(notified.length).toBe(0);
  });

  test("pinned 40-hex ref is skipped, never probed", async () => {
    let probes = 0;
    const { deps, persisted } = makeDeps({
      candidates: [cand("g1", "acme/x", "a".repeat(40))],
      probe: async () => {
        probes++;
        return { sha: "x", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(probes).toBe(0);
    expect(res.skipped).toBe(1);
    expect(persisted.length).toBe(0);
  });

  test("broken source → each skill marked broken + notified; loop continues", async () => {
    const { deps, persisted, notified } = makeDeps({
      concurrency: 1,
      candidates: [
        cand("g1", "gone/x", "main"),
        cand("g2", "gone/x", "main"),
        cand("g3", "live/y", "main", { lastSyncedCommit: "c1" }),
      ],
      probe: async (repo) => {
        if (repo === "gone/x") throw new GitHubSourceNotFoundError(repo, "main");
        return { sha: "c1", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(res.broken).toBe(2);
    expect(notified.map((n) => n.skillGuid).sort()).toEqual(["g1", "g2"]);
    expect(persisted.filter((p) => p.patch.driftState === "broken").length).toBe(2);
    // The live group after the broken one still got processed.
    expect(res.checked).toBe(1);
    expect(persisted.some((p) => p.guid === "g3" && p.patch.driftState === "in_sync")).toBe(true);
  });

  test("rate-limit → short-circuits remaining groups; counts them skipped", async () => {
    let calls = 0;
    const { deps, persisted } = makeDeps({
      concurrency: 1, // deterministic order
      candidates: [
        cand("g1", "a/x", "main"),
        cand("g2", "b/y", "main"),
        cand("g3", "c/z", "main"),
      ],
      probe: async () => {
        calls++;
        if (calls === 1) throw new GitHubRateLimitError(403, 1000);
        return { sha: "s", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(calls).toBe(1); // no probing after the rate-limit signal
    expect(res.skipped).toBe(3); // the rate-limited group + the two never attempted
    expect(res.checked).toBe(0);
    expect(persisted.length).toBe(0);
  });

  test("drift persists upstreamHeadSha + etag + lastCheckedAt", async () => {
    const { deps, persisted } = makeDeps({
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", etag: 'W/"e"', notModified: false }),
    });
    await runSourceDriftJob(deps);
    const patch = persisted.find((p) => p.guid === "g1")!.patch;
    expect(patch.driftState).toBe("drifted");
    expect(patch.upstreamHeadSha).toBe("new");
    expect(patch.etag).toBe('W/"e"');
    expect(patch.lastCheckedAt).toBeInstanceOf(Date);
  });

  test("304 notModified → in_sync; the stored etag is sent", async () => {
    let seenEtag: string | undefined;
    const { deps, persisted } = makeDeps({
      candidates: [cand("g1", "a/x", "main", { etag: 'W/"prev"' })],
      probe: async (_r, _ref, o) => {
        seenEtag = o?.etag;
        return { notModified: true };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(seenEtag).toBe('W/"prev"');
    expect(res.checked).toBe(1);
    expect(res.drifted).toBe(0);
    expect(persisted[0]!.patch.driftState).toBe("in_sync");
  });

  test("transient probe error → group skipped, other groups still processed", async () => {
    const { deps, persisted } = makeDeps({
      concurrency: 1,
      candidates: [
        cand("g1", "flaky/x", "main"),
        cand("g2", "ok/y", "main", { lastSyncedCommit: "c1" }),
      ],
      probe: async (repo) => {
        if (repo === "flaky/x") throw new Error("ECONNRESET");
        return { sha: "c1", notModified: false };
      },
    });
    const res = await runSourceDriftJob(deps);
    expect(res.skipped).toBe(1);
    expect(res.checked).toBe(1);
    expect(persisted.some((p) => p.guid === "g2")).toBe(true);
    expect(persisted.some((p) => p.guid === "g1")).toBe(false);
  });

  test("a persist failure for one skill does not abort the tick", async () => {
    const persisted: string[] = [];
    const deps: SourceDriftJobDeps = {
      skillRepo: {
        findGithubSourcedSkills: async () => [
          cand("g1", "a/x", "main", { lastSyncedCommit: "c1" }),
          cand("g2", "b/y", "main", { lastSyncedCommit: "c1" }),
        ],
        updateSourceDriftState: async (guid) => {
          if (guid === "g1") throw new Error("mongo write failed");
          persisted.push(guid);
        },
      },
      settingsService: {
        getSourceSync: async () => ({
          enabled: true,
          githubToken: "",
          pollSchedule: "*/15 * * * *",
          minCheckIntervalMinutes: 60,
          autoPublish: false,
        }),
      },
      notifier: {
        notifySourceBroken: async () => {},
        notifyAutoSynced: async () => {},
        notifyAutoSyncFailed: async () => {},
      },
      logger,
      probeRefHead: async () => ({ sha: "c1", notModified: false }),
      concurrency: 1,
      jitterMs: 0,
    };
    const res = await runSourceDriftJob(deps);
    // Both counted as checked; g2 still persisted despite g1's write throwing.
    expect(res.checked).toBe(2);
    expect(persisted).toContain("g2");
  });

  test("emits skill.source_drift_detected for every drift, regardless of autoPublish", async () => {
    const { deps, activity } = makeDeps({
      autoPublishSetting: false, // OFF
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    await runSourceDriftJob(deps);
    const drift = activity.filter((a) => a.action === "skill.source_drift_detected");
    expect(drift.length).toBe(1);
    expect(drift[0]!.properties.skillId).toBe("g1");
  });

  test("autoPublish OFF → autoPublish callback is never invoked", async () => {
    let called = 0;
    const { deps } = makeDeps({
      autoPublishSetting: false,
      autoPublish: async () => {
        called++;
        return { status: "published", fromVersion: "1.0", toVersion: "1.1" };
      },
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    await runSourceDriftJob(deps);
    expect(called).toBe(0);
  });

  test("autoPublish ON + published → notifyAutoSynced + skill.auto_synced event", async () => {
    const { deps, autoSynced, activity } = makeDeps({
      autoPublishSetting: true,
      autoPublish: async () => ({ status: "published", fromVersion: "1.0", toVersion: "1.1" }),
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    const res = await runSourceDriftJob(deps);
    expect(res.autoPublished).toBe(1);
    expect(autoSynced).toEqual([{ skillGuid: "g1", fromVersion: "1.0", toVersion: "1.1" }]);
    expect(activity.some((a) => a.action === "skill.auto_synced")).toBe(true);
  });

  test("autoPublish ON + changed_unversioned → notifyAutoSyncFailed, counted", async () => {
    const { deps, autoFailed } = makeDeps({
      autoPublishSetting: true,
      autoPublish: async () => ({ status: "changed_unversioned" }),
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    const res = await runSourceDriftJob(deps);
    expect(res.autoSyncFailed).toBe(1);
    expect(autoFailed).toEqual([
      { skillGuid: "g1", reason: "upstream changed but SKILL.md version not bumped" },
    ]);
  });

  test("autoPublish ON + validation_failed → notifyAutoSyncFailed with reason", async () => {
    const { deps, autoFailed } = makeDeps({
      autoPublishSetting: true,
      autoPublish: async () => ({ status: "validation_failed", reason: "validation_failed: bad zip" }),
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    const res = await runSourceDriftJob(deps);
    expect(res.autoSyncFailed).toBe(1);
    expect(autoFailed[0]!.reason).toContain("bad zip");
  });

  test("autoPublish ON + error → no notification, tick continues", async () => {
    const { deps, autoFailed, autoSynced } = makeDeps({
      autoPublishSetting: true,
      autoPublish: async () => ({ status: "error", reason: "network blip" }),
      candidates: [cand("g1", "a/x", "main", { lastSyncedCommit: "old" })],
      probe: async () => ({ sha: "new", notModified: false }),
    });
    const res = await runSourceDriftJob(deps);
    expect(res.autoPublished).toBe(0);
    expect(res.autoSyncFailed).toBe(0);
    expect(autoFailed.length).toBe(0);
    expect(autoSynced.length).toBe(0);
    expect(res.drifted).toBe(1);
  });

  test("autoPublish callback throwing does not abort the tick", async () => {
    const { deps } = makeDeps({
      autoPublishSetting: true,
      autoPublish: async () => {
        throw new Error("unexpected");
      },
      candidates: [
        cand("g1", "a/x", "main", { lastSyncedCommit: "old" }),
        cand("g2", "b/y", "main", { lastSyncedCommit: "old" }),
      ],
      concurrency: 1,
      probe: async () => ({ sha: "new", notModified: false }),
    });
    const res = await runSourceDriftJob(deps);
    expect(res.drifted).toBe(2); // both still processed despite the throw
  });
});
