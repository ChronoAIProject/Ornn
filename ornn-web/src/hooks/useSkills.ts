import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
import {
  fetchSkill,
  createSkill,
  updateSkill,
  updateSkillPackage,
  deleteSkill,
} from "@/services/skillApi";
import type { SkillSearchParams } from "@/types/search";
import type { UpdateSkillMetadata } from "@/types/api";

const SKILLS_KEY = "skills";
const MY_SKILLS_KEY = "my-skills";

/** Search public skills */
export function useSkills(params: {
  query?: string;
  mode?: SkillSearchParams["mode"];
  page?: number;
  pageSize?: number;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "public",
    page: params.page,
    pageSize: params.pageSize,
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
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: params.mode ?? "keyword",
    scope: "private",
    page: params.page,
    pageSize: params.pageSize,
  };

  return useQuery({
    queryKey: [MY_SKILLS_KEY, searchParams],
    queryFn: () => searchSkills(searchParams),
  });
}

/** Fetch a single skill by ID or name */
export function useSkill(idOrName: string) {
  return useQuery({
    queryKey: [SKILLS_KEY, idOrName],
    queryFn: () => fetchSkill(idOrName),
    enabled: !!idOrName,
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
