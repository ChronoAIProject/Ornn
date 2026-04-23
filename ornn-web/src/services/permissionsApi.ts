/**
 * Client for the per-skill permissions endpoint.
 */

import { apiPut } from "./apiClient";
import type { SkillDetail } from "@/types/domain";

export interface SkillPermissionsInput {
  isPrivate: boolean;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
}

export async function updateSkillPermissions(
  skillGuid: string,
  body: SkillPermissionsInput,
): Promise<SkillDetail> {
  const res = await apiPut<SkillDetail>(`/api/v1/skills/${encodeURIComponent(skillGuid)}/permissions`, body);
  return res.data!;
}
