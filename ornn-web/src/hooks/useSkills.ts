import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { searchSkills, fetchSkillCounts } from "@/services/searchApi";
import {
  fetchSkill,
  fetchSkillVersions,
  createSkill,
  updateSkill,
  updateSkillPackage,
  deleteSkill,
  setSkillVersionDeprecation,
} from "@/services/skillApi";
import { updateSkillPermissions, type SkillPermissionsInput } from "@/services/permissionsApi";
import type { SkillSearchParams, SystemFilter } from "@/types/search";
import type { UpdateSkillMetadata } from "@/types/api";

const SKILLS_KEY = "skills";
const MY_SKILLS_KEY = "my-skills";
const SHARED_WITH_ME_KEY = "shared-with-me-skills";
const SKILL_COUNTS_KEY = "skill-counts";
const SKILL_VERSIONS_KEY = "skill-versions";

/** Search public skills */
export function useSkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
  /** Optional topic id-or-name — restricts results to that topic's members. */
  topic?: string;
  systemFilter?: SystemFilter;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "public",
    page: params.page,
    pageSize: params.pageSize,
    topic: params.topic,
    systemFilter: params.systemFilter,
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
export function useMySkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
  topic?: string;
  systemFilter?: SystemFilter;
  sharedWithOrgs?: string[];
  sharedWithUsers?: string[];
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "mine",
    page: params.page,
    pageSize: params.pageSize,
    topic: params.topic,
    systemFilter: params.systemFilter,
    sharedWithOrgs: params.sharedWithOrgs,
    sharedWithUsers: params.sharedWithUsers,
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
export function useSharedWithMeSkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
  topic?: string;
  systemFilter?: SystemFilter;
  sharedWithOrgs?: string[];
  createdByAny?: string[];
  enabled?: boolean;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "shared-with-me",
    page: params.page,
    pageSize: params.pageSize,
    topic: params.topic,
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

/** Toggle the deprecation flag on a specific published version. */
export function useSetVersionDeprecation(idOrName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      version,
      isDeprecated,
      deprecationNote,
    }: {
      version: string;
      isDeprecated: boolean;
      deprecationNote?: string;
    }) => setSkillVersionDeprecation(idOrName, version, { isDeprecated, deprecationNote }),
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
 * Replace the skill's visibility config in one atomic call. Invalidates
 * the skill detail query so the UI redraws with the new permissions
 * without needing a manual refetch.
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

/** Delete a skill */
export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SKILLS_KEY] });
      queryClient.invalidateQueries({ queryKey: [MY_SKILLS_KEY] });
    },
  });
}
