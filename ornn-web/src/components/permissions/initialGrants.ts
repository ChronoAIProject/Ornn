/**
 * Shared helpers (#1125) for seeding the PermissionsEditor from a skill or
 * skillset detail, and for the modal's reset-key signature. Both detail types
 * expose the same `grants` + legacy `sharedWith*` fields.
 *
 * @module components/permissions/initialGrants
 */

import type { SkillGrant } from "@/types/domain";

interface GrantSource {
  grants?: SkillGrant[];
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
}

/**
 * The grants to seed the editor with: the canonical `grants` when present,
 * else read-level grants derived from the legacy lists (older cached detail).
 */
export function initialGrantsForEditor(detail: GrantSource): SkillGrant[] {
  if (detail.grants) return detail.grants;
  return [
    ...detail.sharedWithUsers.map((id) => ({ type: "user" as const, id, level: "read" as const })),
    ...detail.sharedWithOrgs.map((id) => ({ type: "org" as const, id, level: "read" as const })),
  ];
}

/** Order-independent signature for the modal reset key. */
export function grantsSignature(grants: SkillGrant[]): string {
  return grants.map((g) => `${g.type}:${g.id}:${g.level}`).sort().join("|");
}
