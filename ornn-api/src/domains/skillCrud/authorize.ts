/**
 * Authorization helpers for skill access.
 *
 * Visibility (read) and write rules for a single skill, in one place so the
 * routes / service / topic domain all converge on the same policy.
 *
 * Rules:
 *   - PUBLIC skill → anyone can read.
 *   - PRIVATE skill owned by a person → only that person (or platform admin).
 *   - PRIVATE skill owned by an org → any admin + member of that org, plus
 *     the actual author regardless of role, plus platform admin.
 *
 * Write (update / delete / deprecation-toggle):
 *   - Author (`createdBy === actor`) → always allowed.
 *   - `ownerId` is an org AND actor is admin of that org → allowed.
 *   - Platform admin → allowed.
 *   - Else denied.
 *
 * @module domains/skillCrud/authorize
 */

import type { OrgMembershipFact } from "../../middleware/nyxidAuth";

export interface SkillOwnership {
  ownerId: string;
  createdBy: string;
  isPrivate: boolean;
}

export interface ActorContext {
  userId: string;
  memberships: OrgMembershipFact[];
  isPlatformAdmin: boolean;
}

/** Returns true when `actor` is allowed to read the skill. */
export function canReadSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (!skill.isPrivate) return true;
  if (actor.isPlatformAdmin) return true;
  if (skill.createdBy === actor.userId) return true;
  // `ownerId` can be either a person user_id (== createdBy for personal
  // skills) or an org user_id. Match it against the actor's org memberships.
  return actor.memberships.some((m) => m.userId === skill.ownerId);
}

/**
 * Returns true when `actor` is allowed to mutate (update / delete /
 * deprecate versions of) the skill.
 */
export function canManageSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (actor.isPlatformAdmin) return true;
  if (skill.createdBy === actor.userId) return true;
  // Org admin of the owning org can manage any skill under that org.
  return actor.memberships.some(
    (m) => m.userId === skill.ownerId && m.role === "admin",
  );
}

/** True when actor is currently a member (admin or member role) of the given org. */
export function isMemberOfOrg(actor: ActorContext, orgUserId: string): boolean {
  return actor.memberships.some((m) => m.userId === orgUserId);
}
