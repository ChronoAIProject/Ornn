/**
 * useSkillAccess — the frontend mirror of the backend's three access tiers
 * (#1127). One place computes who-can-do-what for a skill/skillset so the
 * detail page, edit page, and any future surface agree (and match
 * `authorize.ts` server-side).
 *
 * - READ is implicit in being able to load the resource.
 * - `canWrite` (READ_WRITE tier): owner OR platform admin OR a `write` grant
 *   that matches the caller directly (user grant) or via membership of a
 *   granted org. Best-effort — the backend is the real gate; this only
 *   decides whether to SHOW the edit affordances.
 * - `canManage` (ADMIN tier): owner OR platform admin only. Gates the
 *   danger-zone / permissions / visibility actions.
 *
 * @module hooks/useSkillAccess
 */

import { useMemo } from "react";
import { useCurrentUser, useIsAuthenticated, isAdmin } from "@/stores/authStore";
import { useMyOrgs } from "@/hooks/useMe";
import type { SkillGrant } from "@/types/domain";

export interface SkillAccess {
  isOwner: boolean;
  isAdmin: boolean;
  /** May update content/metadata — owner, admin, or a write-grantee. */
  canWrite: boolean;
  /** May administer (permissions, transfer, delete, visibility) — owner/admin. */
  canManage: boolean;
}

/** Minimal shape needed to evaluate access. Both detail types satisfy it. */
interface AccessSource {
  createdBy: string;
  grants?: SkillGrant[];
}

export function useSkillAccess(skill?: AccessSource | null): SkillAccess {
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const adminFlag = isAdmin(user);
  const { data: myOrgs = [] } = useMyOrgs();

  return useMemo(() => {
    const isOwner = !!(isAuthenticated && user?.id && skill?.createdBy === user.id);
    const canManage = isOwner || adminFlag;

    let canWrite = canManage;
    if (!canWrite && isAuthenticated && user?.id && skill?.grants?.length) {
      const myOrgIds = new Set(myOrgs.map((o) => o.userId));
      canWrite = skill.grants.some(
        (g) =>
          g.level === "write" &&
          ((g.type === "user" && g.id === user.id) ||
            (g.type === "org" && myOrgIds.has(g.id))),
      );
    }

    return { isOwner, isAdmin: adminFlag, canWrite, canManage };
  }, [isAuthenticated, user, adminFlag, skill, myOrgs]);
}
