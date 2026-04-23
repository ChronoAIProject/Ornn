/**
 * Caller-scoped endpoints — /api/me/*.
 *
 * The me/orgs endpoint returns the user's NyxID org memberships (admin +
 * member only; viewer rows are filtered server-side). Used by the skill
 * create flow's owner picker and by the profile dropdown's org section.
 */

import { apiGet } from "./apiClient";

export interface MeIdentity {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

/**
 * Read the caller's identity as the backend sees it — source of truth
 * when the OAuth id_token is missing email/name claims (e.g.
 * admin-created users).
 */
export async function fetchMe(): Promise<MeIdentity | null> {
  try {
    const res = await apiGet<MeIdentity>("/api/me");
    return res.data ?? null;
  } catch {
    return null;
  }
}

export interface MyOrgMembership {
  /** The org's NyxID `user_id`. */
  userId: string;
  /** `"admin"` or `"member"` — Ornn filters out viewer server-side. */
  role: "admin" | "member";
  /** Human label for pickers / dropdowns. Falls back to userId on the server. */
  displayName: string;
}

export async function fetchMyOrgs(): Promise<MyOrgMembership[]> {
  const res = await apiGet<{ items: MyOrgMembership[] }>("/api/me/orgs");
  return res.data?.items ?? [];
}

/** NyxID user-service the caller can manage (personal or org-inherited). */
export interface MyNyxidService {
  id: string;
  slug: string;
  label: string;
}

export async function fetchMyNyxidServices(): Promise<MyNyxidService[]> {
  const res = await apiGet<{ items: MyNyxidService[] }>("/api/me/nyxid-services");
  return res.data?.items ?? [];
}

/** Aggregate-summary row for a given org or user target. */
export interface GrantBucketOrg {
  id: string;
  displayName: string;
  skillCount: number;
}

export interface GrantBucketUser {
  userId: string;
  email: string;
  displayName: string;
  skillCount: number;
}

export interface GrantsSummary {
  orgs: GrantBucketOrg[];
  users: GrantBucketUser[];
}

/** "Which orgs/users have I shared my skills with?" */
export async function fetchMySkillGrantsSummary(): Promise<GrantsSummary> {
  const res = await apiGet<GrantsSummary>("/api/me/skills/grants-summary");
  return res.data ?? { orgs: [], users: [] };
}

/** "Which orgs/users gave me access to their skills?" */
export async function fetchSharedSkillSourcesSummary(): Promise<GrantsSummary> {
  const res = await apiGet<GrantsSummary>("/api/me/shared-skills/sources-summary");
  return res.data ?? { orgs: [], users: [] };
}
