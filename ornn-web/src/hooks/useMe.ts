/**
 * React Query hooks for caller-scoped data (`/api/me/*`).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchMyOrgs, type MyOrgMembership } from "@/services/meApi";
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
