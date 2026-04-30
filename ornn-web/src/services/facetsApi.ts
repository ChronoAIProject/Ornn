/**
 * Skill-facet aggregator endpoints — drive the per-tab sidebar filters.
 *
 *   GET /skill-facets/tags?scope=...
 *   GET /skill-facets/authors?scope=...
 *   GET /skill-facets/system-services
 *
 * @module services/facetsApi
 */

import { apiGet } from "./apiClient";

export type FacetScope = "public" | "mine" | "shared-with-me" | "system" | "mixed";

export interface SkillTagFacet {
  name: string;
  count: number;
}

export interface SkillAuthorFacet {
  userId: string;
  email: string;
  displayName: string;
  count: number;
}

export interface SystemServiceFacet {
  id: string;
  slug: string;
  label: string;
  count: number;
}

export async function fetchSkillTagFacets(scope: FacetScope): Promise<SkillTagFacet[]> {
  const res = await apiGet<{ items: SkillTagFacet[] }>("/api/v1/skill-facets/tags", { scope });
  return res.data?.items ?? [];
}

export async function fetchSkillAuthorFacets(scope: FacetScope): Promise<SkillAuthorFacet[]> {
  const res = await apiGet<{ items: SkillAuthorFacet[] }>("/api/v1/skill-facets/authors", { scope });
  return res.data?.items ?? [];
}

export async function fetchSystemServiceFacets(): Promise<SystemServiceFacet[]> {
  const res = await apiGet<{ items: SystemServiceFacet[] }>("/api/v1/skill-facets/system-services");
  return res.data?.items ?? [];
}
