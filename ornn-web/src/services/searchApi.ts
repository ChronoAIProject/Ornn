import { apiGet } from "./apiClient";
import type { SkillSearchParams, SkillSearchResponse } from "@/types/search";

/**
 * Search skills using the skill-search API.
 * GET /api/skill-search with query params.
 */
export async function searchSkills(
  params: SkillSearchParams
): Promise<SkillSearchResponse> {
  const queryParams: Record<string, string | number | undefined> = {
    query: params.query,
    mode: params.mode,
    scope: params.scope,
    page: params.page,
    pageSize: params.pageSize,
  };

  const res = await apiGet<SkillSearchResponse>("/api/skill-search", queryParams);
  return res.data!;
}

/**
 * Perform a semantic search.
 * Convenience wrapper around searchSkills with mode=semantic.
 */
export async function semanticSearch(
  query: string,
  scope: SkillSearchParams["scope"] = "public",
  page?: number,
  pageSize?: number,
): Promise<SkillSearchResponse> {
  return searchSkills({ query, mode: "semantic", scope, page, pageSize });
}
