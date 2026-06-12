/**
 * Skillset authorization helpers (#969).
 *
 * A skillset's ownership/visibility shape mirrors a skill's verbatim
 * (`isPrivate` / `sharedWithUsers` / `sharedWithOrgs` / `createdBy`), so
 * the read/write gates delegate straight to the skills `authorize.ts`
 * helpers — there is exactly one visibility policy, shared across both
 * resources, and it can never drift.
 *
 * @module domains/skillsets/authorize
 */

import {
  canReadSkill,
  canManageSkill,
  type ActorContext,
} from "../skills/crud/authorize";

/** Minimal ownership shape (subset of SkillsetDocument / detail). */
export interface SkillsetOwnership {
  createdBy: string;
  isPrivate: boolean;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
}

/** True when `actor` may read the skillset. Delegates to the skill gate. */
export function canReadSkillset(
  skillset: SkillsetOwnership,
  actor: ActorContext,
): boolean {
  return canReadSkill(skillset, actor);
}

/** True when `actor` may mutate the skillset. Delegates to the skill gate. */
export function canManageSkillset(
  skillset: SkillsetOwnership,
  actor: ActorContext,
): boolean {
  return canManageSkill(skillset, actor);
}
