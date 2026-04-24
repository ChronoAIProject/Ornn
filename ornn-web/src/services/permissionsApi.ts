/**
 * Client for the per-skill permissions endpoint. The endpoint is
 * audit-gated: new grants (user / org / public) that bring in fresh
 * access go through the platform's audit pipeline and may come back as
 * pending waiver requests rather than being applied immediately.
 *
 * @module services/permissionsApi
 */

import { apiPut } from "./apiClient";
import type { SkillDetail } from "@/types/domain";
import type { ShareRequest } from "@/types/shares";

export interface SkillPermissionsInput {
  isPrivate: boolean;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
}

export interface SkillPermissionsResult {
  /** Skill state after removes + any auto-approved adds were applied. */
  skill: SkillDetail;
  /**
   * One entry per newly-added grant target. `status === "green"` means
   * the grant was applied immediately; anything else means a waiver
   * request is open and awaits owner justification + reviewer decision.
   */
  waivers: ShareRequest[];
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
