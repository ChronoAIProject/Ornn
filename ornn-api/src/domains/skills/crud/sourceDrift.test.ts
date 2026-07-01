import { describe, expect, test } from "bun:test";
import { runSourceDriftCheck, type SourceDriftDeps } from "./sourceDrift";
import {
  GitHubSourceNotFoundError,
  type RefHeadProbeResult,
} from "./utils/githubPull";
import type { SkillDocument } from "../../../shared/types/index";

type Probe = NonNullable<SourceDriftDeps["probeRefHead"]>;

function githubSkill(
  source: Partial<{
    repo: string;
    ref: string;
    path: string;
    lastSyncedCommit: string;
    etag: string;
  }>,
): SkillDocument {
  return {
    source: { type: "github", repo: "acme/x", ref: "main", path: "", ...source },
  } as unknown as SkillDocument;
}

function fakeDeps(opts: { skill: SkillDocument | null; probe?: Probe }): {
  deps: SourceDriftDeps;
  persisted: Array<Record<string, unknown>>;
} {
  const persisted: Array<Record<string, unknown>> = [];
  const deps: SourceDriftDeps = {
    skillRepo: {
      findByGuid: async () => opts.skill,
      updateSourceDriftState: async (_g, patch) => {
        persisted.push(patch as Record<string, unknown>);
      },
    },
    ...(opts.probe ? { probeRefHead: opts.probe } : {}),
  };
  return { deps, persisted };
}

describe("runSourceDriftCheck", () => {
  test("HEAD != lastSyncedCommit → drifted; persists sha + etag + lastCheckedAt", async () => {
    const { deps, persisted } = fakeDeps({
      skill: githubSkill({ lastSyncedCommit: "old", etag: 'W/"e0"' }),
      probe: async (): Promise<RefHeadProbeResult> => ({
        sha: "new",
        etag: 'W/"e1"',
        notModified: false,
      }),
    });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(res).toEqual({ applicable: true, driftState: "drifted", upstreamHeadSha: "new" });
    expect(persisted[0]).toMatchObject({
      driftState: "drifted",
      upstreamHeadSha: "new",
      etag: 'W/"e1"',
    });
    expect(persisted[0]!.lastCheckedAt).toBeInstanceOf(Date);
  });

  test("HEAD == lastSyncedCommit → in_sync", async () => {
    const { deps, persisted } = fakeDeps({
      skill: githubSkill({ lastSyncedCommit: "same" }),
      probe: async () => ({ sha: "same", notModified: false }),
    });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(res.driftState).toBe("in_sync");
    expect(persisted[0]).toMatchObject({ driftState: "in_sync", upstreamHeadSha: "same" });
  });

  test("304 notModified → in_sync; probe receives the stored etag", async () => {
    let seenEtag: string | undefined;
    const { deps, persisted } = fakeDeps({
      skill: githubSkill({ lastSyncedCommit: "x", etag: 'W/"stored"' }),
      probe: async (_r, _ref, opts) => {
        seenEtag = opts?.etag;
        return { notModified: true };
      },
    });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(seenEtag).toBe('W/"stored"');
    expect(res.driftState).toBe("in_sync");
    expect(persisted[0]).toMatchObject({ driftState: "in_sync" });
  });

  test("GitHubSourceNotFoundError → broken (persisted, not thrown)", async () => {
    const { deps, persisted } = fakeDeps({
      skill: githubSkill({}),
      probe: async () => {
        throw new GitHubSourceNotFoundError("acme/x", "main");
      },
    });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(res.driftState).toBe("broken");
    expect(persisted[0]).toMatchObject({ driftState: "broken" });
  });

  test("transient (non-404) error is re-thrown and nothing is persisted", async () => {
    const { deps, persisted } = fakeDeps({
      skill: githubSkill({}),
      probe: async () => {
        throw new Error("network boom");
      },
    });
    await expect(runSourceDriftCheck(deps, "g1", "tok")).rejects.toThrow(/network boom/);
    expect(persisted.length).toBe(0);
  });

  test("empty token → probe called anonymously (token undefined)", async () => {
    let seenToken: string | undefined = "unset";
    const { deps } = fakeDeps({
      skill: githubSkill({ lastSyncedCommit: "a" }),
      probe: async (_r, _ref, opts) => {
        seenToken = opts?.token;
        return { sha: "a", notModified: false };
      },
    });
    await runSourceDriftCheck(deps, "g1", "");
    expect(seenToken).toBeUndefined();
  });

  test("skill without a github source → applicable:false, no persistence", async () => {
    const { deps, persisted } = fakeDeps({
      skill: { source: undefined } as unknown as SkillDocument,
    });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(res).toEqual({ applicable: false });
    expect(persisted.length).toBe(0);
  });

  test("missing skill → applicable:false", async () => {
    const { deps } = fakeDeps({ skill: null });
    const res = await runSourceDriftCheck(deps, "g1", "tok");
    expect(res.applicable).toBe(false);
  });
});
