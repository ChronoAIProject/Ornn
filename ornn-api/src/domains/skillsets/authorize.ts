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
  canWriteSkill,
  canManageSkill,
  type ActorContext,
} from "../skills/crud/authorize";
import type { SkillGrant } from "../../shared/types/index";

/** Minimal ownership shape (subset of SkillsetDocument / detail). */
export interface SkillsetOwnership {
  createdBy: string;
  isPrivate: boolean;
  /** Typed grants (#1123); optional — gates fall back to the legacy lists. */
  grants?: SkillGrant[] | undefined;
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

/**
 * True when `actor` may UPDATE the skillset's content/metadata (publish a new
 * version) — the READ_WRITE tier (#1123). Delegates to the skill gate.
 */
export function canWriteSkillset(
  skillset: SkillsetOwnership,
  actor: ActorContext,
): boolean {
  return canWriteSkill(skillset, actor);
}

/**
 * True when `actor` may ADMINISTER the skillset (permissions, transfer,
 * delete) — the ADMIN tier. Author + platform admin only. Delegates to the
 * skill gate.
 */
export function canManageSkillset(
  skillset: SkillsetOwnership,
  actor: ActorContext,
): boolean {
  return canManageSkill(skillset, actor);
}
