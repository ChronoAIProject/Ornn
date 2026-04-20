import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
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
import type { SkillSearchParams } from "@/types/search";
import type { UpdateSkillMetadata } from "@/types/api";

const SKILLS_KEY = "skills";
const MY_SKILLS_KEY = "my-skills";
const SKILL_VERSIONS_KEY = "skill-versions";

/** Search public skills */
export function useSkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
  /** Optional topic id-or-name — restricts results to that topic's members. */
  topic?: string;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "public",
    page: params.page,
    pageSize: params.pageSize,
    topic: params.topic,
  };

  return useQuery({
    queryKey: [SKILLS_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
  });
}

/** Search current user's private skills */
export function useMySkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
  /** Optional topic id-or-name — restricts results to that topic's members. */
  topic?: string;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "private",
    page: params.page,
    pageSize: params.pageSize,
    topic: params.topic,
  };

  return useQuery({
    queryKey: [MY_SKILLS_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
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
