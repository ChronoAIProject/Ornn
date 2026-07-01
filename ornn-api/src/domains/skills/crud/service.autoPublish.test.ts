import { describe, expect, test } from "bun:test";
import { SkillService, type SkillServiceDeps } from "./service";
import { SYSTEM_SYNC_ACTOR } from "./sourceDrift";
import { AppError } from "../../../shared/types/index";
import type { SkillDocument, SkillDetailResponse } from "../../../shared/types/index";

function driftedSkill(overrides: Record<string, unknown> = {}): SkillDocument {
  return {
    guid: "g1",
    latestVersion: "1.0",
    createdBy: "owner-1",
    source: {
      type: "github",
      repo: "a/x",
      ref: "main",
      path: "",
      lastSyncedCommit: "old",
      upstreamHeadSha: "new",
      driftState: "drifted",
    },
    ...overrides,
  } as unknown as SkillDocument;
}

function makeService(skill: SkillDocument | null): {
  svc: SkillService;
  persisted: Array<{ guid: string; patch: Record<string, unknown> }>;
} {
  const persisted: Array<{ guid: string; patch: Record<string, unknown> }> = [];
  const deps = {
    skillRepo: {
      findByGuid: async () => skill,
      updateSourceDriftState: async (guid: string, patch: Record<string, unknown>) => {
        persisted.push({ guid, patch });
      },
    },
  } as unknown as SkillServiceDeps;
  return { svc: new SkillService(deps), persisted };
}

/** Override the instance's refreshSkillFromSource so we test autoPublish's
 *  outcome mapping without the real pull/publish chain. */
function stubRefresh(
  svc: SkillService,
  impl: (...args: unknown[]) => Promise<SkillDetailResponse>,
): { calls: unknown[][] } {
  const calls: unknown[][] = [];
  (svc as unknown as { refreshSkillFromSource: unknown }).refreshSkillFromSource = (
    ...args: unknown[]
  ) => {
    calls.push(args);
    return impl(...args);
  };
  return { calls };
}

describe("SkillService.autoPublishFromSource", () => {
  test("published: refresh succeeds → published outcome + in_sync, under system actor", async () => {
    const { svc, persisted } = makeService(driftedSkill());
    const { calls } = stubRefresh(svc, async () => ({ version: "1.1" }) as SkillDetailResponse);
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome).toEqual({ status: "published", fromVersion: "1.0", toVersion: "1.1" });
    expect(persisted.at(-1)!.patch.driftState).toBe("in_sync");
    // refresh called with the system source-sync actor, not the linking user.
    expect(calls[0]![1]).toBe(SYSTEM_SYNC_ACTOR.userId);
  });

  test("VERSION_NOT_INCREMENTED → changed_unversioned; drift persisted, not published", async () => {
    const { svc, persisted } = makeService(driftedSkill());
    stubRefresh(svc, async () => {
      throw AppError.conflict("VERSION_NOT_INCREMENTED", "bump the version");
    });
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("changed_unversioned");
    expect(persisted.at(-1)!.patch.driftState).toBe("changed_unversioned");
  });

  test("validation AppError → validation_failed + driftState broken", async () => {
    const { svc, persisted } = makeService(driftedSkill());
    stubRefresh(svc, async () => {
      throw AppError.badRequest("validation_failed", "[rule] bad frontmatter");
    });
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("validation_failed");
    if (outcome.status === "validation_failed") {
      expect(outcome.reason).toContain("validation_failed");
    }
    expect(persisted.at(-1)!.patch.driftState).toBe("broken");
  });

  test("non-AppError (transient) → error; driftState left drifted (no persist)", async () => {
    const { svc, persisted } = makeService(driftedSkill());
    stubRefresh(svc, async () => {
      throw new Error("ECONNRESET");
    });
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("error");
    // Nothing persisted — the skill stays `drifted` for the next tick to retry.
    expect(persisted.length).toBe(0);
  });

  test("not drifted → skipped, refresh never called", async () => {
    const skill = driftedSkill({
      source: {
        type: "github",
        repo: "a/x",
        ref: "main",
        path: "",
        lastSyncedCommit: "old",
        driftState: "in_sync",
      },
    });
    const { svc } = makeService(skill);
    const { calls } = stubRefresh(svc, async () => ({ version: "1.1" }) as SkillDetailResponse);
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("skipped");
    expect(calls.length).toBe(0);
  });

  test("idempotency: upstreamHeadSha == lastSyncedCommit → skipped (already synced)", async () => {
    const skill = driftedSkill({
      source: {
        type: "github",
        repo: "a/x",
        ref: "main",
        path: "",
        lastSyncedCommit: "same",
        upstreamHeadSha: "same",
        driftState: "drifted",
      },
    });
    const { svc } = makeService(skill);
    const { calls } = stubRefresh(svc, async () => ({ version: "1.1" }) as SkillDetailResponse);
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome).toEqual({ status: "skipped", reason: "already_synced" });
    expect(calls.length).toBe(0);
  });

  test("no github source → skipped", async () => {
    const { svc } = makeService({ source: undefined } as unknown as SkillDocument);
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("skipped");
  });

  test("missing skill → skipped", async () => {
    const { svc } = makeService(null);
    const outcome = await svc.autoPublishFromSource("g1");
    expect(outcome.status).toBe("skipped");
  });
});
