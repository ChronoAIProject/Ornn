/**
 * Authorization helpers for skill access.
 *
 * Single source of truth for read/write gates. Routes, service, and the
 * topic domain all converge on these so tests only need to exercise the
 * policy once.
 *
 * Read (visibility):
 *   - PUBLIC skill → anyone.
 *   - PRIVATE skill:
 *     - author (`createdBy === actor.userId`) → yes
 *     - actor's user_id is in `sharedWithUsers` → yes
 *     - actor is admin/member of any org in `sharedWithOrgs` → yes
 *     - platform admin (`ornn:admin:skill`) → yes
 *     - else → no
 *
 * Write (update / delete / change-permissions / deprecation-toggle):
 *   - author → yes
 *   - platform admin → yes
 *   - else → 403
 *
 *   Note: org-admins no longer automatically inherit write access. If an
 *   author wants collaborators to edit, they can grant the user directly
 *   (future work — the current ACL is read-only).
 *
 * @module domains/skillCrud/authorize
 */

import type { OrgMembershipFact } from "../../middleware/nyxidAuth";

export interface SkillOwnership {
  /** Author (person user_id). Always present. */
  createdBy: string;
  isPrivate: boolean;
  /** Explicit per-user allow-list. Empty = nobody extra beyond author. */
  sharedWithUsers: string[];
  /** Explicit per-org allow-list. Empty = nobody extra beyond author. */
  sharedWithOrgs: string[];
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
  if (skill.sharedWithUsers.includes(actor.userId)) return true;
  if (skill.sharedWithOrgs.length > 0) {
    for (const m of actor.memberships) {
      if (skill.sharedWithOrgs.includes(m.userId)) return true;
    }
  }
  return false;
}

/**
 * Returns true when `actor` is allowed to mutate the skill — update
 * package, change permissions, toggle deprecation, or delete. Author-only
 * plus platform admin.
 */
export function canManageSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (actor.isPlatformAdmin) return true;
  return skill.createdBy === actor.userId;
}

/**
 * True when `actor` is currently a member (admin or member role) of the
 * given org. Used by the topic create path — not by skill visibility.
 */
export function isMemberOfOrg(actor: ActorContext, orgUserId: string): boolean {
  return actor.memberships.some((m) => m.userId === orgUserId);
}
