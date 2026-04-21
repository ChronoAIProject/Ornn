/**
 * Caller-scoped endpoints — /api/me/*.
 *
 * The me/orgs endpoint returns the user's NyxID org memberships (admin +
 * member only; viewer rows are filtered server-side). Used by the skill
 * create flow's owner picker and by the profile dropdown's org section.
 */

import { apiGet } from "./apiClient";

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
