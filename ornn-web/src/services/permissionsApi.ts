/**
 * Client for the per-skill permissions endpoint. Sharing is unconditional —
 * the backend applies the requested visibility directly. Audit findings are
 * surfaced afterwards as notifications, not as a gate on the save.
 *
 * @module services/permissionsApi
 */

import { apiPut } from "./apiClient";
import type { SkillDetail } from "@/types/domain";

export interface SkillPermissionsInput {
  isPrivate: boolean;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
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
