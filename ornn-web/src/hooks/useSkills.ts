import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { searchSkills, fetchSkillCounts } from "@/services/searchApi";
import {
  fetchSkill,
  fetchSkillVersions,
  fetchSkillVersionDiff,
  createSkill,
  updateSkill,
  updateSkillPackage,
  deleteSkill,
  deleteSkillVersion,
  setSkillVersionDeprecation,
  pullSkillFromGitHub,
  refreshSkillFromSource,
  previewSkillRefresh,
  setSkillSource,
  tieSkillToNyxidService,
  type PullFromGitHubInput,
} from "@/services/skillApi";
import { updateSkillPermissions, type SkillPermissionsInput } from "@/services/permissionsApi";
import type { SkillSearchParams, SystemFilter } from "@/types/search";
import type { UpdateSkillMetadata } from "@/types/api";

const SKILLS_KEY = "skills";
const MY_SKILLS_KEY = "my-skills";
const SHARED_WITH_ME_KEY = "shared-with-me-skills";
const SKILL_COUNTS_KEY = "skill-counts";
const SKILL_VERSIONS_KEY = "skill-versions";
const SKILL_VERSION_DIFF_KEY = "skill-version-diff";

/**
 * Search platform-wide system skills. System skills are always public,
 * so `scope: "public"` + `systemFilter: "only"` is the right query.
 * Visible to anonymous + authed callers; the System tab itself is the
 * primary consumer.
 */
// Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
export function useSystemSkills(params: {
  query?: string | undefined;
  mode?: SkillSearchParams["mode"];
  page?: number | undefined;
  pageSize?: number | undefined;
  nyxidServiceId?: string | undefined;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "public",
    page: params.page,
    pageSize: params.pageSize,
    systemFilter: "only",
    nyxidServiceId: params.nyxidServiceId,
  };
  return useQuery({
    queryKey: ["system-skills", searchParams],
    queryFn: () => searchSkills(searchParams),
  });
}

/** Search public skills */
// exactOptionalPropertyTypes (#657)
export function useSkills(params: {
  query?: string | undefined;
  mode?: SkillSearchParams["mode"];
  page?: number | undefined;
  pageSize?: number | undefined;
  systemFilter?: SystemFilter | undefined;
  tags?: string[] | undefined;
  createdByAny?: string[] | undefined;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "public",
    page: params.page,
    pageSize: params.pageSize,
    systemFilter: params.systemFilter,
    tags: params.tags,
    createdByAny: params.createdByAny,
  };

  return useQuery({
    queryKey: [SKILLS_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
  });
}

/**
 * Search skills authored by the caller. Strict "mine" scope — does
 * NOT include skills shared with me (those live in the dedicated
 * Shared-with-me tab). Public + private skills I created both appear.
 */
// exactOptionalPropertyTypes (#657)
export function useMySkills(params: {
  query?: string | undefined;
  mode?: SkillSearchParams["mode"];
  page?: number | undefined;
  pageSize?: number | undefined;
  systemFilter?: SystemFilter | undefined;
  sharedWithOrgs?: string[] | undefined;
  sharedWithUsers?: string[] | undefined;
  tags?: string[] | undefined;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "mine",
    page: params.page,
    pageSize: params.pageSize,
    systemFilter: params.systemFilter,
    sharedWithOrgs: params.sharedWithOrgs,
    sharedWithUsers: params.sharedWithUsers,
    tags: params.tags,
  };

  return useQuery({
    queryKey: [MY_SKILLS_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
  });
}

/**
 * Search skills that other users or orgs have shared with the caller.
 * Excludes own-authored skills and public skills; those live in their
 * dedicated tabs. Gated on auth — anonymous callers get an empty set.
 */
// exactOptionalPropertyTypes (#657)
export function useSharedWithMeSkills(params: {
  query?: string | undefined;
  mode?: SkillSearchParams["mode"];
  page?: number | undefined;
  pageSize?: number | undefined;
  systemFilter?: SystemFilter | undefined;
  sharedWithOrgs?: string[] | undefined;
  createdByAny?: string[] | undefined;
  enabled?: boolean | undefined;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "shared-with-me",
    page: params.page,
    pageSize: params.pageSize,
    systemFilter: params.systemFilter,
    sharedWithOrgs: params.sharedWithOrgs,
    createdByAny: params.createdByAny,
  };

  return useQuery({
    queryKey: [SHARED_WITH_ME_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
    enabled: params.enabled ?? true,
  });
}

/**
 * Fetch registry tab counts in one round-trip. `mine` and
 * `sharedWithMe` are 0 for anonymous callers — the backend doesn't
 * know who they are. Cached briefly since counts change slowly.
 */
export function useSkillCounts() {
  return useQuery({
    queryKey: [SKILL_COUNTS_KEY],
    queryFn: fetchSkillCounts,
    staleTime: 30_000,
  });
}

/**
 * Fetch a single skill by ID or name.
 * When `version` is provided, resolves to that specific published version;
 * otherwise returns the latest. Query key includes `version` so switching
 * between versions uses the cache correctly.
 */
export function useSkill(idOrName: string, version?: string) {
  return useQuery({
    queryKey: [SKILLS_KEY, idOrName, version ?? "latest"],
    queryFn: () => fetchSkill(idOrName, version),
    enabled: !!idOrName,
  });
}

/** List every published version for a skill, newest first. */
export function useSkillVersions(idOrName: string) {
  return useQuery({
    queryKey: [SKILL_VERSIONS_KEY, idOrName],
    queryFn: () => fetchSkillVersions(idOrName),
    enabled: !!idOrName,
  });
}

/**
 * Diff two specific versions of a skill. Disabled until both `from` and
 * `to` are non-empty AND distinct — the backend rejects a same-version
 * compare with `400 SAME_VERSION` and we don't want that round-trip.
 */
export function useSkillVersionDiff(
  idOrName: string,
  fromVersion: string,
  toVersion: string,
) {
  return useQuery({
    queryKey: [SKILL_VERSION_DIFF_KEY, idOrName, fromVersion, toVersion],
    queryFn: () => fetchSkillVersionDiff(idOrName, fromVersion, toVersion),
    enabled:
      !!idOrName && !!fromVersion && !!toVersion && fromVersion !== toVersion,
  });
}

/**
 * Toggle the deprecation flag on a specific published version.
 *
 * Two-id split (#750): `guid` is the WIRE id — version-write routes are
 * GUID-only (CONVENTIONS §2.2), so a name-opened Skill Detail must still
 * send the GUID or the backend 404s. `idOrName` is the CACHE-KEY id —
 * the read queries (`useSkill`, `useSkillVersions`) are keyed on
 * `idOrName`, so invalidation MUST stay keyed on it (#699's All-versions
 * modal refresh re-breaks otherwise).
 */
export function useSetVersionDeprecation(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      version,
      isDeprecated,
      deprecationNote,
    }: {
      version: string;
      isDeprecated: boolean;
      // exactOptionalPropertyTypes (#657)
      deprecationNote?: string | undefined;
    }) => setSkillVersionDeprecation(guid, version, { isDeprecated, deprecationNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY, idOrName] });
      queryClient.invalidateQueries({ queryKey: [SKILL_VERSIONS_KEY, idOrName] });
    },
  });
}

/** Create a new skill from a ZIP file */
export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ zipFile, skipValidation }: { zipFile: File; skipValidation?: boolean }) =>
      createSkill(zipFile, skipValidation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}

/** Pull a new skill from a public GitHub repo. */
export function usePullSkillFromGitHub() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PullFromGitHubInput) => pullSkillFromGitHub(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}

/** Re-pull the skill's GitHub source and publish a fresh version. */
export function useRefreshSkillFromSource(idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      guid,
      skipValidation,
    }: {
      guid: string;
      // exactOptionalPropertyTypes (#657)
      skipValidation?: boolean | undefined;
    }) => refreshSkillFromSource(guid, { skipValidation }),
    onSuccess: (updated) => {
      // Prime the detail cache with the refreshed payload so the chip
      // updates in place.
      queryClient.setQueryData([SKILLS_KEY, idOrName, undefined], updated);
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SKILL_VERSIONS_KEY, idOrName] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}

/** Dry-run a refresh — pull from GitHub, compute diff, return without bumping. */
export function usePreviewSkillRefresh() {
  return useMutation({
    mutationFn: (guid: string) => previewSkillRefresh(guid),
  });
}

/** Attach (or clear) a GitHub source pointer on an existing skill. */
export function useSetSkillSource(idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ guid, githubUrl }: { guid: string; githubUrl: string | null }) =>
      setSkillSource(guid, githubUrl),
    onSuccess: (updated) => {
      queryClient.setQueryData([SKILLS_KEY, idOrName, undefined], updated);
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
    },
  });
}

/** Update skill metadata (e.g. toggle isPrivate) */
export function useUpdateSkill(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSkillMetadata) => updateSkill(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}

/** Update skill package by uploading a new ZIP */
export function useUpdateSkillPackage(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ zipFile, skipValidation }: { zipFile: File; skipValidation?: boolean }) =>
      updateSkillPackage(id, zipFile, skipValidation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}

/**
 * Replace the skill's visibility config in one atomic call. The save is
 * unconditional; audit runs out-of-band. Invalidates the skill detail
 * query so the UI redraws with the new permissions without needing a
 * manual refetch.
 */
export function useUpdateSkillPermissions(idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillPermissionsInput) => updateSkillPermissions(idOrName, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY, idOrName] });
    },
  });
}

/**
 * Tie or untie a skill to a NyxID catalog service. Invalidates the
 * registry tabs (especially System) and the skill detail cache so the
 * tied chip + privacy flag both redraw without a manual refetch.
 */
export function useTieSkillToNyxidService(idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { skillId: string; nyxidServiceId: string | null }) =>
      tieSkillToNyxidService(input.skillId, input.nyxidServiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY, idOrName] });
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: ["system-skills"] });
      queryClient.invalidateQueries({ queryKey: [SKILL_COUNTS_KEY] });
    },
  });
}

/**
 * Delete an entire skill (every version).
 *
 * Two-id split (#750 shape): `guid` is the WIRE id — the delete route is
 * GUID-only, so a name-opened Skill Detail must still send the GUID.
 * `idOrName` is the CACHE-KEY id — the detail/versions read queries
 * (`useSkill`, `useSkillVersions`) are keyed on `idOrName`, and callers
 * pass either the GUID (MySkillsPage card) or a NAME (Skill Detail URL),
 * so cache cleanup must cover BOTH keyings.
 *
 * #940 — onSuccess must REMOVE the deleted skill's detail + versions
 * entries (not just invalidate). The detail query stays mounted through
 * the delete (the `navigate("/registry")` in the caller runs AFTER this
 * onSuccess, and RootLayout's breadcrumb re-subscribes), so a broad
 * `invalidateQueries([SKILLS_KEY])` prefix-matches the still-mounted
 * detail key and triggers a refetch of the just-deleted skill → 404.
 * `removeQueries` drops the cache entry outright so nothing can refetch
 * it; the list/count keys still invalidate to drop the deleted card.
 * Removal is id-scoped (predicate on `guid`/`idOrName`) so only the
 * deleted skill's caches are touched, never other skills'.
 */
export function useDeleteSkill(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deleteSkill(guid),
    onSuccess: () => {
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILLS_KEY &&
          (q.queryKey[1] === guid || q.queryKey[1] === idOrName),
      });
      queryClient.removeQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === SKILL_VERSIONS_KEY &&
          (q.queryKey[1] === guid || q.queryKey[1] === idOrName),
      });
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [SKILL_COUNTS_KEY] });
      // #941 — the My-Skills filter sidebar counts come from SEPARATE
      // queries that #940's invalidations don't touch: the "mine" tag
      // facet (useSkillTagFacets("mine")) and the grants summary
      // (useMySkillGrantsSummary). Refresh exactly those two so the
      // per-tag chips + per-grantee/org "shared with" counts stay
      // consistent after a self-delete without a full-page refresh.
      // Narrow literals on purpose: the broad ["skill-facets"] prefix
      // would refetch the public/system facets a self-delete can't
      // change, and broad ["me"] would refetch orgs/nyxid-services.
      queryClient.invalidateQueries({ queryKey: ["skill-facets", "tags", "mine"] });
      queryClient.invalidateQueries({ queryKey: ["me", "skills", "grants-summary"] });
    },
  });
}

/**
 * Delete one non-latest version of a skill. Refreshes the skill itself,
 * its versions list, and the audit history (which is keyed per version).
 *
 * Two-id split (#750): `guid` is the WIRE id — version-write routes are
 * GUID-only (CONVENTIONS §2.2), so a name-opened Skill Detail must still
 * send the GUID or the backend 404s and the version is never deleted.
 * `idOrName` is the CACHE-KEY id — ALL invalidation below stays keyed on
 * it so the read queries (and #699's All-versions modal) refresh.
 */
export function useDeleteSkillVersion(guid: string, idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => deleteSkillVersion(guid, version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY, idOrName] });
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
      // #699 — the All-versions modal subscribes to
      // [SKILL_VERSIONS_KEY, idOrName]; without this invalidation
      // the deleted row stays visible and a second delete click
      // hits the backend with the now-missing version.
      queryClient.invalidateQueries({ queryKey: [SKILL_VERSIONS_KEY, idOrName] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === "audit" &&
          q.queryKey[1] === idOrName,
      });
    },
  });
}
