/**
 * Directory lookups backed by Ornn's own activity log.
 *
 * Both endpoints are read-only and require auth.
 */

import { apiGet } from "./apiClient";

export interface UserDirectoryEntry {
  userId: string;
  email: string;
  displayName: string;
}

export async function searchUsersByEmail(
  query: string,
  limit = 10,
): Promise<UserDirectoryEntry[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await apiGet<{ items: UserDirectoryEntry[] }>(`/api/v1/users/search?${params.toString()}`);
  return res.data?.items ?? [];
}

/**
 * Batch-resolve a list of user_ids to email + displayName. Unknown ids
 * (users who never signed into Ornn) are omitted from the response.
 */
export async function resolveUsers(ids: string[]): Promise<UserDirectoryEntry[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(",") });
  const res = await apiGet<{ items: UserDirectoryEntry[] }>(
    `/api/v1/users/resolve?${params.toString()}`,
  );
  return res.data?.items ?? [];
}

export interface OrgDirectoryEntry {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}

/**
 * Proxied back-fill lookup for a saved org id. Used by the permissions
 * panel to render a human label for an org the caller no longer belongs
 * to. Returns `null` when the org is hidden or unknown — the UI should
 * render the raw id + a "removed from org" hint in that case.
 */
export async function fetchOrgSummary(orgId: string): Promise<OrgDirectoryEntry | null> {
  try {
    const res = await apiGet<OrgDirectoryEntry>(`/api/v1/me/orgs/${encodeURIComponent(orgId)}`);
    return res.data ?? null;
  } catch {
    return null;
  }
}
