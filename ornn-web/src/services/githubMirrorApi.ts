/**
 * Client for the GitHub mirror admin surface and its single
 * public-read endpoint.
 *
 * Three operations:
 *
 *   - `fetchGithubRepo()` — public, returns the configured mirror
 *     coords + enabled flag. SkillDetailPage reads this so the
 *     `npx skills add` snippet can be rendered to anonymous viewers.
 *
 *   - `updateGithubRepo()` — admin, patches the mirror coords. Pass
 *     `confirmAbandonOldRepo: true` if the change would orphan a
 *     non-empty mirror (server returns `OLD_REPO_NOT_CONFIRMED` 409
 *     otherwise).
 *
 *   - `fetchMirrorStatus()` / `triggerMirrorReconcile()` — admin
 *     overview + manual reconcile kickoff. Reconcile is fire-and-
 *     forget: returns 202 immediately and the page polls
 *     `fetchMirrorStatus()` to see when the run lands.
 *
 * @module services/githubMirrorApi
 */

import { apiGet, apiPost } from "./apiClient";

export interface GithubRepoConfig {
  owner: string;
  repo: string;
  branch: string;
  /** Configmap kill switch — when false the mirror feature is off in
   * this deployment, regardless of what `owner`/`repo` say. */
  enabled: boolean;
}

export interface GithubRepoUpdatePayload {
  owner: string;
  repo: string;
  branch: string;
  /** Required when changing owner/repo would abandon a non-empty mirror. */
  confirmAbandonOldRepo?: boolean;
}

export interface MirrorReconcileResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

export interface MirrorStatus {
  enabled: boolean;
  repo: { owner: string; repo: string; branch: string };
  counts: {
    /** Skills that are eligible for the mirror (`isPrivate: false`). */
    eligible: number;
    /** `mirrorSync.version === latestVersion`. */
    synced: number;
    /** Mirrored, but the stamp's version trails latestVersion. */
    lagging: number;
    /** Eligible but no `mirrorSync` stamp. */
    neverSynced: number;
    /** ISO of the oldest never-synced skill's `createdOn`, null when none. */
    oldestUnsyncedAt: string | null;
  };
  lastReconcile: {
    status: "idle" | "running";
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    result: MirrorReconcileResult | null;
    error: string | null;
  };
}

export async function fetchGithubRepo(): Promise<GithubRepoConfig> {
  const res = await apiGet<GithubRepoConfig>("/api/v1/github/repo");
  return res.data!;
}

export async function updateGithubRepo(
  payload: GithubRepoUpdatePayload,
): Promise<GithubRepoConfig> {
  const res = await apiPost<GithubRepoConfig>("/api/v1/github/repo", payload);
  return res.data!;
}

export async function fetchMirrorStatus(): Promise<MirrorStatus> {
  const res = await apiGet<MirrorStatus>("/api/v1/admin/mirror/status");
  return res.data!;
}

export async function triggerMirrorReconcile(): Promise<{
  status: "running";
  startedAt: string;
}> {
  const res = await apiPost<{ status: "running"; startedAt: string }>(
    "/api/v1/admin/mirror/reconcile",
    {},
  );
  return res.data!;
}
