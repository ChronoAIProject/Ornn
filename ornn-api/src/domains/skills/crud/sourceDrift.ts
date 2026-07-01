/**
 * Source-drift check (#1175) — the read-only "did upstream move?" probe for
 * a GitHub-sourced skill.
 *
 * Extracted from `SkillService` (which is already large) so the logic is
 * unit-testable in isolation and the service exposes only a thin delegating
 * method. This NEVER re-pulls, publishes, or mutates the skill package — it
 * only reads the upstream HEAD via the cheap `git/ref` probe and persists
 * the drift verdict + ETag on `source`. The scheduler (#1176) and
 * auto-publish (#1177) build on the state this writes.
 *
 * @module domains/skills/crud/sourceDrift
 */
import { createLogger } from "../../../shared/logger";
import type { SkillSourceDriftState } from "../../../shared/types/index";
import type { SkillRepository } from "./repository";
import {
  resolveRefHeadSha,
  GitHubSourceNotFoundError,
  type RefHeadProbeInput,
  type RefHeadProbeResult,
} from "./utils/githubPull";

const logger = createLogger("sourceDrift");

export interface SourceDriftResult {
  /** False when the skill has no GitHub source — nothing to check. */
  readonly applicable: boolean;
  /** The verdict written to `source.driftState`. Absent when not applicable. */
  readonly driftState?: SkillSourceDriftState;
  /** The upstream HEAD SHA observed (present on a live probe, not on `broken`). */
  readonly upstreamHeadSha?: string;
}

export interface SourceDriftDeps {
  readonly skillRepo: Pick<
    SkillRepository,
    "findByGuid" | "updateSourceDriftState"
  >;
  /**
   * Cheap HEAD-SHA probe. Injectable so tests can drive the 304 / drift /
   * 404 branches without real network. Defaults to the real
   * {@link resolveRefHeadSha}.
   */
  readonly probeRefHead?: (
    repo: string,
    ref: string,
    opts?: RefHeadProbeInput,
  ) => Promise<RefHeadProbeResult>;
}

/**
 * Check a single skill for upstream drift and persist the verdict.
 *
 * @param token Service-account token, or `""` for anonymous (rate-limited)
 *   reads. Empty logs a warning but still probes.
 */
export async function runSourceDriftCheck(
  deps: SourceDriftDeps,
  guid: string,
  token: string,
): Promise<SourceDriftResult> {
  const probe = deps.probeRefHead ?? resolveRefHeadSha;
  const skill = await deps.skillRepo.findByGuid(guid);
  if (!skill || !skill.source || skill.source.type !== "github") {
    return { applicable: false };
  }
  const source = skill.source;
  if (token.length === 0) {
    logger.warn(
      { guid, repo: source.repo },
      "source drift check running unauthenticated — GitHub reads are limited to 60/hr per IP",
    );
  }
  const now = new Date();

  try {
    const result = await probe(source.repo, source.ref, {
      token: token || undefined,
      etag: source.etag,
    });

    // 304 — nothing changed since the stored ETag. Free on authenticated
    // requests; just record that we looked.
    if (result.notModified) {
      await deps.skillRepo.updateSourceDriftState(guid, {
        driftState: "in_sync",
        lastCheckedAt: now,
      });
      logger.debug({ guid, repo: source.repo }, "source drift check: 304 not modified");
      return { applicable: true, driftState: "in_sync" };
    }

    const sha = result.sha!;
    const drifted = sha !== source.lastSyncedCommit;
    const driftState: SkillSourceDriftState = drifted ? "drifted" : "in_sync";
    await deps.skillRepo.updateSourceDriftState(guid, {
      driftState,
      upstreamHeadSha: sha,
      ...(result.etag ? { etag: result.etag } : {}),
      lastCheckedAt: now,
    });
    logger.info(
      { guid, repo: source.repo, ref: source.ref, driftState, upstreamHeadSha: sha },
      "source drift check complete",
    );
    return { applicable: true, driftState, upstreamHeadSha: sha };
  } catch (err) {
    // A genuinely missing repo/ref is a terminal, per-skill state — record
    // it and return. Transient failures (network, 5xx) are re-thrown so the
    // caller/scheduler can retry rather than mislabel a blip as broken.
    if (err instanceof GitHubSourceNotFoundError) {
      await deps.skillRepo.updateSourceDriftState(guid, {
        driftState: "broken",
        lastCheckedAt: now,
      });
      logger.warn(
        { guid, repo: source.repo, ref: source.ref },
        "source drift check: upstream not found — marked broken",
      );
      return { applicable: true, driftState: "broken" };
    }
    throw err;
  }
}
