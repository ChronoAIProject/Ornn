/**
 * TanStack Query hooks for the skillsets domain (#1059).
 *
 * Mirrors `useSkills.ts`: per-scope list queries, a detail query keyed on
 * `idOrName + version`, a versions query, a closure query, and create /
 * publish / delete / permissions mutations with the same invalidation shape.
 *
 * Two-id split (mirrors #750): write routes (publish / delete / permissions)
 * are GUID-only, so a name-opened detail page must send the GUID on the wire
 * while keying cache invalidation on the URL `idOrName`.
 *
 * @module hooks/useSkillsets
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  searchSkillsets,
  fetchSkillset,
  fetchSkillsetVersions,
  fetchSkillsetClosure,
  createSkillset,
  publishSkillset,
  deleteSkillset,
  updateSkillsetPermissions,
} from "@/services/skillsetApi";
import type {
  CreateSkillsetInput,
  PublishSkillsetInput,
  SkillsetKind,
  SkillsetPermissionsInput,
  SkillsetScope,
  SkillsetSearchParams,
} from "@/types/skillset";

const SKILLSETS_KEY = "skillsets";
const MY_SKILLSETS_KEY = "my-skillsets";
const SHARED_WITH_ME_KEY = "shared-with-me-skillsets";
const SKILLSET_VERSIONS_KEY = "skillset-versions";
const SKILLSET_CLOSURE_KEY = "skillset-closure";

/** Common per-scope list params. */
interface SkillsetListParams {
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  kind?: SkillsetKind | undefined;
  tags?: string[] | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  enabled?: boolean | undefined;
}

function buildSearchParams(
  scope: SkillsetScope,
  params: SkillsetListParams,
): SkillsetSearchParams {
  return {
    scope,
    kind: params.kind,
    tags: params.tags,
    page: params.page,
    pageSize: params.pageSize,
  };
}

/** Search public skillsets. Visible to anonymous + authed callers. */
export function usePublicSkillsets(params: SkillsetListParams) {
  const searchParams = buildSearchParams("public", params);
  return useQuery({
    queryKey: [SKILLSETS_KEY, searchParams],
    queryFn: () => searchSkillsets(searchParams),
    enabled: params.enabled ?? true,
  });
}

/** Search skillsets authored by the caller (public + private I created). */
export function useMySkillsets(params: SkillsetListParams) {
  const searchParams = buildSearchParams("mine", params);
  return useQuery({
    queryKey: [MY_SKILLSETS_KEY, searchParams],
    queryFn: () => searchSkillsets(searchParams),
    enabled: params.enabled ?? true,
  });
}

/** Search skillsets others (users / orgs) have shared with the caller. */
export function useSharedWithMeSkillsets(params: SkillsetListParams) {
  const searchParams = buildSearchParams("shared-with-me", params);
  return useQuery({
    queryKey: [SHARED_WITH_ME_KEY, searchParams],
    queryFn: () => searchSkillsets(searchParams),
    enabled: params.enabled ?? true,
  });
}

/**
 * Fetch a single skillset by ID or name. When `version` is provided, resolves
 * to that specific published version; otherwise the latest. The query key
 * includes `version` so version switching uses the cache correctly.
 */
export function useSkillset(idOrName: string, version?: string) {
  return useQuery({
    queryKey: [SKILLSETS_KEY, idOrName, version ?? "latest"],
    queryFn: () => fetchSkillset(idOrName, version),
    enabled: !!idOrName,
  });
}

/** List every published version for a skillset, newest first. */
export function useSkillsetVersions(idOrName: string) {
  return useQuery({
    queryKey: [SKILLSET_VERSIONS_KEY, idOrName],
    queryFn: () => fetchSkillsetVersions(idOrName),
    enabled: !!idOrName,
  });
}

/**
 * Resolve the skillset's closure (master prompt + flattened deps-first member
 * graph). Keyed on `idOrName + version` so it tracks the version picker.
 */
export function useSkillsetClosure(idOrName: string, version?: string) {
  return useQuery({
    queryKey: [SKILLSET_CLOSURE_KEY, idOrName, version ?? "latest"],
    queryFn: () => fetchSkillsetClosure(idOrName, version),
    enabled: !!idOrName,
  });
}

/** Create a new skillset. Invalidates the public + mine list tabs. */
export function useCreateSkillset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillsetInput) => createSkillset(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLSETS_KEY] });
    },
  });
}

/**
 * Publish a new immutable version. `guid` is the WIRE id (publish is
 * GUID-only); `idOrName` is the CACHE-KEY id so the detail + versions read
 * queries refresh whether the page was opened by name or guid.
 */
export function usePublishSkillset(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PublishSkillsetInput) => publishSkillset(guid, input),
    onSuccess: (updated) => {
      // Prime the detail (latest) cache with the published payload so the
      // page redraws in place without a manual refetch.
      queryClient.setQueryData([SKILLSETS_KEY, idOrName, "latest"], updated);
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY, idOrName] });
      queryClient.invalidateQueries({ queryKey: [SKILLSET_VERSIONS_KEY, idOrName] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILLSET_CLOSURE_KEY &&
          q.queryKey[1] === idOrName,
      });
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLSETS_KEY] });
    },
  });
}

/**
 * Replace the skillset's visibility config. `guid` is the WIRE id;
 * `idOrName` is the CACHE-KEY id. Invalidates the detail + list tabs so the
 * visibility chips + cards redraw.
 */
export function useUpdateSkillsetPermissions(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillsetPermissionsInput) =>
      updateSkillsetPermissions(guid, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SHARED_WITH_ME_KEY] });
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY, idOrName] });
    },
  });
}

/**
 * Delete an entire skillset (every version).
 *
 * Two-id split (#750 shape): `guid` is the WIRE id — the delete route is
 * GUID-only. `idOrName` is the CACHE-KEY id — the detail / versions / closure
 * read queries are keyed on it, and callers pass either the GUID (browse card)
 * or a NAME (detail URL), so cache cleanup must cover BOTH keyings.
 *
 * #940 — onSuccess must REMOVE the deleted skillset's detail + versions +
 * closure entries (not just invalidate). The detail query stays mounted
 * through the delete (the caller's `navigate(...)` runs AFTER this onSuccess,
 * and the breadcrumb re-subscribes), so a broad `invalidateQueries`
 * prefix-matches the still-mounted detail key and triggers a refetch of the
 * just-deleted skillset → 404. `removeQueries` drops the cache entry outright
 * so nothing can refetch it; the list keys still invalidate to drop the
 * deleted card. Removal is id-scoped (predicate on `guid` / `idOrName`) so
 * only the deleted skillset's caches are touched, never other skillsets'.
 */
export function useDeleteSkillset(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteSkillset(guid),
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILLSETS_KEY &&
          (q.queryKey[1] === guid || q.queryKey[1] === idOrName),
      });
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILLSET_VERSIONS_KEY &&
          (q.queryKey[1] === guid || q.queryKey[1] === idOrName),
      });
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILLSET_CLOSURE_KEY &&
          (q.queryKey[1] === guid || q.queryKey[1] === idOrName),
      });
      queryClient.invalidateQueries({ queryKey: [SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLSETS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SHARED_WITH_ME_KEY] });
    },
  });
}
