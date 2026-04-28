/**
 * React Query hooks for caller-scoped data (`/api/v1/me/*`) and the
 * skill-facet aggregator endpoints (`/api/v1/skill-facets/*`).
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchMyOrgs,
  fetchMyNyxidServices,
  fetchMySkillGrantsSummary,
  fetchSharedSkillSourcesSummary,
  type MyOrgMembership,
} from "@/services/meApi";
import {
  fetchSkillTagFacets,
  fetchSkillAuthorFacets,
  fetchSystemServiceFacets,
  type FacetScope,
} from "@/services/facetsApi";
import { useIsAuthenticated } from "@/stores/authStore";

const MY_ORGS_KEY = ["me", "orgs"] as const;

/**
 * Returns the caller's org memberships. Gated on auth — anonymous callers
 * short-circuit to an empty list without firing a network request.
 *
 * Cached for 5 minutes: org membership changes are infrequent and NyxID is
 * the source of truth, so we don't need to re-query on every mount.
 */
export function useMyOrgs() {
  const isAuthed = useIsAuthenticated();
  return useQuery<MyOrgMembership[]>({
    queryKey: MY_ORGS_KEY,
    queryFn: fetchMyOrgs,
    enabled: isAuthed,
    staleTime: 5 * 60_000,
  });
}

/** NyxID user-services accessible to the caller. Used for the System-skill filter label lookup. */
export function useMyNyxidServices() {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: ["me", "nyxid-services"] as const,
    queryFn: fetchMyNyxidServices,
    enabled: isAuthed,
    staleTime: 5 * 60_000,
  });
}

/** Aggregated grantees for the caller's own skills — drives the My-Skills filter chips. */
export function useMySkillGrantsSummary() {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: ["me", "skills", "grants-summary"] as const,
    queryFn: fetchMySkillGrantsSummary,
    enabled: isAuthed,
    staleTime: 30_000,
  });
}

/** Aggregated sources for skills shared with the caller — drives Shared-with-me filter chips. */
export function useSharedSkillSources() {
  const isAuthed = useIsAuthenticated();
  return useQuery({
    queryKey: ["me", "shared-skills", "sources-summary"] as const,
    queryFn: fetchSharedSkillSourcesSummary,
    enabled: isAuthed,
    staleTime: 30_000,
  });
}

/**
 * Distinct skill tags within scope, with per-tag counts. Powers the
 * tag-filter chip rows on Public + My + System tabs.
 */
export function useSkillTagFacets(scope: FacetScope, enabled = true) {
  return useQuery({
    queryKey: ["skill-facets", "tags", scope] as const,
    queryFn: () => fetchSkillTagFacets(scope),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Distinct skill authors within scope, with per-author counts. Powers
 * the author-filter chip row on the Public tab.
 */
export function useSkillAuthorFacets(scope: FacetScope, enabled = true) {
  return useQuery({
    queryKey: ["skill-facets", "authors", scope] as const,
    queryFn: () => fetchSkillAuthorFacets(scope),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * NyxID services that have at least one tied system skill, with
 * per-service skill counts. Powers the System-tab service-filter chip
 * row.
 */
export function useSystemServiceFacets(enabled = true) {
  return useQuery({
    queryKey: ["skill-facets", "system-services"] as const,
    queryFn: fetchSystemServiceFacets,
    enabled,
    staleTime: 30_000,
  });
}
