/**
 * React Query hooks for the GitHub mirror surface.
 *
 *   - `useGithubRepo()` — public read; SkillDetailPage uses it to
 *     compose `npx skills add <owner>/<repo>/<skill>`. 5-minute
 *     staleTime since the value rarely changes.
 *   - `useUpdateGithubRepo()` — admin write; invalidates both repo
 *     and mirror-status caches on success.
 *   - `useMirrorStatus()` — admin overview; auto-refetches every
 *     5s while a reconcile is in `running` state, otherwise stays
 *     on a 30s background refresh.
 *   - `useTriggerReconcile()` — fires the kickoff and prompts an
 *     immediate status refetch.
 *
 * @module hooks/useGithubMirror
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchGithubRepo,
  fetchMirrorStatus,
  triggerMirrorReconcile,
  updateMirrorConfig,
  type GithubRepoConfig,
  type MirrorConfigUpdatePayload,
  type MirrorStatus,
} from "@/services/githubMirrorApi";

const REPO_KEY = ["github-repo"] as const;
const STATUS_KEY = ["mirror-status"] as const;

export function useGithubRepo() {
  return useQuery<GithubRepoConfig>({
    queryKey: REPO_KEY,
    queryFn: fetchGithubRepo,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateMirrorConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: MirrorConfigUpdatePayload) => updateMirrorConfig(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: REPO_KEY });
      qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}

export function useMirrorStatus() {
  return useQuery<MirrorStatus>({
    queryKey: STATUS_KEY,
    queryFn: fetchMirrorStatus,
    // Poll fast while a reconcile is running so the UI shows progress
    // landing without a manual refresh; back off when idle.
    refetchInterval: (q) =>
      q.state.data?.lastReconcile.status === "running" ? 5_000 : 30_000,
    staleTime: 0,
  });
}

export function useTriggerReconcile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: triggerMirrorReconcile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
}
