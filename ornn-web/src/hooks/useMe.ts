/**
 * React Query hooks for caller-scoped data (`/api/v1/me/*`).
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchMyOrgs,
  fetchMyNyxidServices,
  fetchMySkillGrantsSummary,
  fetchSharedSkillSourcesSummary,
  type MyOrgMembership,
} from "@/services/meApi";
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
