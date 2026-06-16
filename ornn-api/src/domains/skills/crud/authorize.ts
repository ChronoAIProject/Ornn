/**
 * Authorization helpers for skill access.
 *
 * Single source of truth for read/write gates. Routes, service, and the
 * topic domain all converge on these so tests only need to exercise the
 * policy once.
 *
 * Three permission tiers (#1123), all derived from one typed `grants` ACL
 * (with a fallback to the legacy read-only lists for un-migrated docs — see
 * `effectiveGrants` in `grants.ts`):
 *
 * READ — `canReadSkill`:
 *   - PUBLIC skill → anyone.
 *   - PRIVATE skill:
 *     - author (`createdBy === actor.userId`) → yes
 *     - platform admin (`ornn:admin:skill`) → yes
 *     - actor holds ANY grant (read or write), directly or via
 *       membership of a granted org → yes
 *     - else → no
 *
 * WRITE — `canWriteSkill` (update content + metadata only):
 *   - author → yes
 *   - platform admin → yes
 *   - actor holds a `write` grant, directly or via a granted org → yes
 *   - else → no
 *
 * ADMIN — `canManageSkill` (change permissions, transfer ownership, delete
 * skill/version, toggle deprecation, manage dist-tags, bind NyxID service):
 *   - author → yes
 *   - platform admin → yes
 *   - else → 403. A `write` grantee is deliberately NOT an admin.
 *
 * Org grants resolve uniformly: every admin/member of a granted org inherits
 * the grant's level. The org-membership-based gates fail soft on an
 * unresolved NyxID lookup (deny), matching the read path — they never grant
 * on a "couldn't ask" result.
 *
 * @module domains/skills/crud/authorize
 */

import type { Context } from "hono";
import {
  getAuth,
  readUserOrgMembershipResolution,
  type AuthVariables,
  type OrgMembershipFact,
} from "../../../middleware/nyxidAuth";
import type { SkillGrant } from "../../../shared/types/index";
import { effectiveGrants } from "./grants";

export interface SkillOwnership {
  /** Author (person user_id). Always present. */
  createdBy: string;
  isPrivate: boolean;
  /**
   * Typed access grants (#1123) — the canonical ACL. Optional: when absent
   * the gates derive read-level grants from the legacy lists below via
   * `effectiveGrants`, so a pre-#1123 doc authorizes exactly as before.
   */
  grants?: SkillGrant[] | undefined;
  /** Legacy per-user read allow-list. Read-fallback source when `grants` absent. */
  sharedWithUsers: string[];
  /** Legacy per-org read allow-list. Read-fallback source when `grants` absent. */
  sharedWithOrgs: string[];
}

export interface ActorContext {
  userId: string;
  memberships: OrgMembershipFact[];
  isPlatformAdmin: boolean;
  /**
   * Whether the org-membership lookup resolved authoritatively (#842).
   * `true` when NyxID answered (including a 200-empty list); `false` when
   * the lookup was unresolved (no forwarded token / NyxID unreachable).
   * Write gates that share a skill into orgs must distinguish an empty
   * `memberships` that means "member of nothing" (resolved) from one that
   * means "we couldn't ask" (unresolved) — the latter is a retryable 503,
   * not a 403. Read gates ignore this field (they fail soft regardless).
   */
  membershipsResolved: boolean;
}

/**
 * Internal/system caller — bypasses visibility (mirror, server-side jobs).
 * `membershipsResolved: true` so system callers are never treated as having
 * an unresolved org lookup.
 */
export const SYSTEM_ACTOR: ActorContext = {
  userId: "__system__",
  memberships: [],
  isPlatformAdmin: true,
  membershipsResolved: true,
};

/**
 * Build the caller's object-level authorization actor from the request.
 * Single source so the ~19 route-level builds cannot drift (#826).
 * Throws 401 (via getAuth) when unauthenticated. Resolves org memberships
 * via the lazy getter mounted by nyxidOrgLookupMiddleware.
 */
export async function buildActorContext(
  c: Context<{ Variables: AuthVariables }>,
): Promise<ActorContext> {
  const auth = getAuth(c);
  // Resolution-aware read (#842): carry whether NyxID answered so the write
  // gate can tell "member of nothing" (resolved) from "couldn't ask"
  // (unresolved). `.memberships` is the same fail-soft `[]` the read path
  // already used for both cases, so read callers are unaffected.
  const resolution = await readUserOrgMembershipResolution(c);
  return {
    userId: auth.userId,
    memberships: resolution.memberships,
    isPlatformAdmin: auth.permissions.includes("ornn:admin:skill"),
    membershipsResolved: resolution.status === "resolved",
  };
}

/**
 * Returns true when `actor` is allowed to READ the skill. Any grant level
 * (read or write) confers read — a write grantee is always also a
 * reader. Public skills are readable by everyone.
 */
export function canReadSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (!skill.isPrivate) return true;
  if (actor.isPlatformAdmin) return true;
  if (skill.createdBy === actor.userId) return true;
  return actorMatchesGrant(skill, actor, () => true);
}

/**
 * Returns true when `actor` may UPDATE the skill's content + metadata — the
 * WRITE tier (#1123). Author + platform admin always qualify; otherwise
 * a `write` grant (direct, or via membership of a granted org) is
 * required. Deliberately NOT sufficient for admin/danger-zone ops — those
 * gate on `canManageSkill`.
 */
export function canWriteSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (actor.isPlatformAdmin) return true;
  if (skill.createdBy === actor.userId) return true;
  return actorMatchesGrant(skill, actor, (g) => g.level === "write");
}

/**
 * Returns true when `actor` may ADMINISTER the skill — change permissions,
 * transfer ownership, delete skill/version, toggle deprecation, manage
 * dist-tags, bind a NyxID service. Author + platform admin only; a
 * write grantee can never administer.
 */
export function canManageSkill(skill: SkillOwnership, actor: ActorContext): boolean {
  if (actor.isPlatformAdmin) return true;
  return skill.createdBy === actor.userId;
}

/**
 * Shared grant-matching core: does `actor` hold a grant (passing `accept`)
 * either directly as a user or via membership of a granted org? Walks the
 * effective grants once so read/write gates can never diverge on the
 * matching rules. Fails soft on org grants when the membership lookup was
 * unresolved (actor.memberships is `[]`), matching the read path.
 */
function actorMatchesGrant(
  skill: SkillOwnership,
  actor: ActorContext,
  accept: (grant: SkillGrant) => boolean,
): boolean {
  const grants = effectiveGrants(skill);
  for (const g of grants) {
    if (!accept(g)) continue;
    if (g.type === "user") {
      if (g.id === actor.userId) return true;
    } else if (actor.memberships.some((m) => m.userId === g.id)) {
      return true;
    }
  }
  return false;
}

/**
 * True when `actor` is currently a member (admin or member role) of the
 * given org. Used by the topic create path — not by skill visibility.
 */
export function isMemberOfOrg(actor: ActorContext, orgUserId: string): boolean {
  return actor.memberships.some((m) => m.userId === orgUserId);
}
