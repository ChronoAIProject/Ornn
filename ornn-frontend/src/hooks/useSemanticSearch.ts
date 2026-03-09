import { useQuery } from "@tanstack/react-query";
import { searchSkills } from "@/services/searchApi";
import type { SkillSearchParams } from "@/types/search";

/** Query hook for semantic (similarity) skill search */
export function useSemanticSearch(params: {
  query: string;
  scope?: SkillSearchParams["scope"];
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}) {
  const searchParams: SkillSearchParams = {
    query: params.query,
    mode: "similarity",
    scope: params.scope ?? "public",
    page: params.page,
    pageSize: params.pageSize,
  };

  return useQuery({
    queryKey: ["semantic-search", searchParams],
    queryFn: () => searchSkills(searchParams),
    enabled: (params.enabled ?? true) && !!params.query.trim(),
  });
}
