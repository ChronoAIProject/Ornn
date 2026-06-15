/**
 * Client for the per-skill permissions endpoint. Sharing is unconditional —
 * the backend applies the requested visibility directly. Audit findings are
 * surfaced afterwards as notifications, not as a gate on the save.
 *
 * @module services/permissionsApi
 */

import { apiPut, apiPost } from "./apiClient";
import type { SkillDetail, SkillGrant } from "@/types/domain";

export interface SkillPermissionsInput {
  isPrivate: boolean;
  /**
   * Canonical typed ACL (#1123). When provided the backend uses it directly.
   * The legacy `sharedWith*` arrays remain accepted for callers that haven't
   * migrated and map to READ-level grants.
   */
  grants?: SkillGrant[];
  sharedWithUsers?: string[];
  sharedWithOrgs?: string[];
}

export interface SkillPermissionsResult {
  skill: SkillDetail;
}

export async function updateSkillPermissions(
  skillGuid: string,
  body: SkillPermissionsInput,
): Promise<SkillPermissionsResult> {
  const res = await apiPut<SkillPermissionsResult>(
    `/api/v1/skills/${encodeURIComponent(skillGuid)}/permissions`,
    body,
  );
  return res.data!;
}

export interface TransferSkillOwnershipResult {
  skill: SkillDetail;
}

/**
 * Transfer a skill to another Ornn user (#1123). Owner / platform-admin only;
 * the target must be a known Ornn user. Returns the refreshed detail — the
 * caller is no longer the owner on success.
 */
export async function transferSkillOwnership(
  skillGuid: string,
  newOwnerUserId: string,
): Promise<TransferSkillOwnershipResult> {
  const res = await apiPost<TransferSkillOwnershipResult>(
    `/api/v1/skills/${encodeURIComponent(skillGuid)}/transfer-ownership`,
    { newOwnerUserId },
  );
  return res.data!;
}
