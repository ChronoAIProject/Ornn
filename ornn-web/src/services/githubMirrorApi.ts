/**
 * Client for the GitHub mirror admin surface and its single
 * public-read endpoint.
 *
 *   - `fetchGithubRepo()` — public, returns the configured mirror coords
 *     + enabled flag. SkillDetailPage reads this so the
 *     `npx skills add` snippet renders to anonymous viewers.
 *
 *   - `updateMirrorConfig()` — admin, patches the full mirror config
 *     (kill switch + repo coords + GitHub App credentials). Pass any
 *     subset; missing fields are preserved server-side. Pass
 *     `confirmAbandonOldRepo: true` if changing `owner`/`repo` would
 *     orphan a non-empty mirror (otherwise the server returns
 *     `OLD_REPO_NOT_CONFIRMED` 409).
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
  /** DB-backed kill switch — when false the mirror feature is off,
   * regardless of what `owner`/`repo` say. Flipped via the admin UI. */
  enabled: boolean;
}

/**
 * Admin payload — every field optional. Server preserves anything the
 * caller doesn't include. `appPrivateKey` carrying any bullet (`•`) is
 * the round-trip sentinel for "preserve existing key" — real PEMs
 * never contain it.
 */
export interface MirrorConfigUpdatePayload {
  enabled?: boolean;
  owner?: string;
  repo?: string;
  branch?: string;
  appId?: string;
  installationId?: string;
  appPrivateKey?: string;
  /** Required when changing owner/repo would abandon a non-empty mirror. */
  confirmAbandonOldRepo?: boolean;
}

/** Full mirror config as returned to admins. `appPrivateKey` is mid-masked. */
export interface AdminMirrorConfig {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  appId: string;
  installationId: string;
  /** Mid-masked: first 4 + last 4 chars, bullets in middle. */
  appPrivateKey: string;
}

export interface MirrorReconcileResult {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

/**
 * Persisted snapshot of the most recent *scheduled* mirror reconcile
 * fire. Sourced from the in-process scheduler reading Agenda's
 * `agendaJobs` doc — survives pod restarts, aggregates across replicas.
 * Manual `Reconcile now` clicks do NOT update this.
 */
export interface MirrorScheduledRun {
  status: "succeeded" | "failed" | "running" | "never_run";
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  /** Last failure message; non-null only when `status === "failed"`. */
  lastError: string | null;
  nextRunAt: string | null;
}

export interface MirrorStatus {
  enabled: boolean;
  repo: { owner: string; repo: string; branch: string };
  appId: string;
  installationId: string;
  /** Mid-masked. */
  appPrivateKey: string;
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
  scheduledRun: MirrorScheduledRun;
}

export async function fetchGithubRepo(): Promise<GithubRepoConfig> {
  const res = await apiGet<GithubRepoConfig>("/api/v1/github/repo");
  return res.data!;
}

export async function updateMirrorConfig(
  payload: MirrorConfigUpdatePayload,
): Promise<AdminMirrorConfig> {
  const res = await apiPost<AdminMirrorConfig>("/api/v1/github/repo", payload);
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
