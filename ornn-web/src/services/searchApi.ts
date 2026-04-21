import { apiGet } from "./apiClient";
import type { SkillCounts, SkillSearchParams, SkillSearchResponse } from "@/types/search";

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
    topic: params.topic,
    systemFilter: params.systemFilter,
    sharedWithOrgs: params.sharedWithOrgs?.length ? params.sharedWithOrgs.join(",") : undefined,
    sharedWithUsers: params.sharedWithUsers?.length ? params.sharedWithUsers.join(",") : undefined,
    createdByAny: params.createdByAny?.length ? params.createdByAny.join(",") : undefined,
  };

  const res = await apiGet<SkillSearchResponse>("/api/skill-search", queryParams);
  return res.data!;
}

/**
 * Fetch per-scope counts for the registry tab badges in a single
 * round-trip. Returns `{public, mine, sharedWithMe}` for the current
 * caller. Anonymous callers get `mine` + `sharedWithMe` as 0.
 */
export async function fetchSkillCounts(): Promise<SkillCounts> {
  const res = await apiGet<SkillCounts>("/api/skill-counts");
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
