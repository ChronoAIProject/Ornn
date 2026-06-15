/**
 * Shared Mongo match-stage builders for scoped + filtered skill queries.
 *
 * Extracted from `crud/repository.ts` (#969) so the skillsets repository
 * (`domains/skillsets/repository.ts`) can reuse the exact same visibility
 * model and registry-chip filters without copy-pasting the logic. Both the
 * `skills` and `skillsets` collections carry the same ownership shape
 * (`isPrivate` / `sharedWithUsers` / `sharedWithOrgs` / `createdBy`), so the
 * scope predicates are identical — keeping them in one module guarantees the
 * two collections can never drift on who-can-see-what.
 *
 * PURE move — no behaviour change. `crud/repository.ts` re-imports both
 * functions; its existing tests pin the matrix.
 *
 * @module domains/skills/crud/scopeFilter
 */

export type SkillScope =
  | "public"
  | "private"
  | "mixed"
  | "shared-with-me"
  | "mine";

/**
 * Additional registry-filter constraints. `sharedWithOrgsAny` requires
 * `sharedWithOrgs` to intersect the list; `sharedWithUsersAny` is the
 * analog for direct per-user grants; `createdByAny` narrows the author
 * (used by the Shared-with-me tab's "from which user" chip row).
 */
export interface ExtraFilters {
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  sharedWithOrgsAny?: string[] | undefined;
  sharedWithUsersAny?: string[] | undefined;
  createdByAny?: string[] | undefined;
  /**
   * Tri-state system-skill filter applied at the DB match level.
   * `"only"`    → `isSystemSkill: true`.
   * `"exclude"` → `isSystemSkill !== true` (covers absent / false / null).
   * `"any"` / undefined → no constraint.
   */
  systemFilter?: "any" | "only" | "exclude" | undefined;
  /** Restrict to skills tied to this exact NyxID service id. */
  nyxidServiceId?: string | undefined;
  /** Skills must have ALL listed tags (AND match against `metadata.tags`). */
  tagsAll?: string[] | undefined;
}

/**
 * Build the visibility match stage for a scoped query.
 *
 * Visibility model (matches `canReadSkill` in authorize.ts):
 *   - `public` scope  → `!isPrivate`.
 *   - `private` scope → every private skill the caller can see: author,
 *     any skill whose `sharedWithUsers` contains the caller's user_id, or
 *     any skill whose `sharedWithOrgs` overlaps the caller's org user_ids.
 *   - `mixed`   scope → union of the two above.
 *
 * Anonymous callers (empty `currentUserId` + empty `userOrgIds`) correctly
 * match nothing for the private branch.
 */
export function applyScope(
  matchStage: Record<string, unknown>,
  scope: SkillScope,
  currentUserId: string,
  userOrgIds: string[],
): void {
  if (scope === "mine") {
    // Skills authored by the caller, regardless of visibility. Strict
    // "skills I own", distinct from "private skills I can read" which
    // would also include skills shared with me.
    if (!currentUserId) {
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.createdBy = currentUserId;
    return;
  }
  const privateVisibility: Array<Record<string, unknown>> = [];
  if (currentUserId) {
    privateVisibility.push({ createdBy: currentUserId });
    privateVisibility.push({ sharedWithUsers: currentUserId });
  }
  if (userOrgIds.length > 0) {
    privateVisibility.push({ sharedWithOrgs: { $in: userOrgIds } });
  }

  if (scope === "public") {
    matchStage.isPrivate = false;
    return;
  }

  if (scope === "private") {
    if (privateVisibility.length === 0) {
      // Anonymous caller with no orgs — nothing to match.
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.isPrivate = true;
    matchStage.$or = privateVisibility;
    return;
  }

  if (scope === "shared-with-me") {
    // Private skills the caller can read but did NOT author.
    // By construction this excludes anonymous callers (no orgs, no user id).
    const grants: Array<Record<string, unknown>> = [];
    if (currentUserId) {
      grants.push({ sharedWithUsers: currentUserId });
    }
    if (userOrgIds.length > 0) {
      grants.push({ sharedWithOrgs: { $in: userOrgIds } });
    }
    if (grants.length === 0) {
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.isPrivate = true;
    matchStage.$and = [
      { $or: grants },
      // `createdBy` excluded explicitly — a skill the caller authored is
      // never "shared with" them in the UI sense.
      ...(currentUserId ? [{ createdBy: { $ne: currentUserId } }] : []),
    ];
    return;
  }

  // mixed
  const clauses: Array<Record<string, unknown>> = [{ isPrivate: false }];
  if (privateVisibility.length > 0) {
    clauses.push({ isPrivate: true, $or: privateVisibility });
  }
  matchStage.$or = clauses;
}

/**
 * Merge the registry chip filters into an existing match stage.
 * Appended as additional clauses on `$and` so they compose cleanly
 * with whatever `applyScope` already set up.
 */
export function applyExtraFilters(
  matchStage: Record<string, unknown>,
  filters: ExtraFilters | undefined,
): void {
  if (!filters) return;
  const extra: Array<Record<string, unknown>> = [];
  if (filters.sharedWithOrgsAny && filters.sharedWithOrgsAny.length > 0) {
    extra.push({ sharedWithOrgs: { $in: filters.sharedWithOrgsAny } });
  }
  if (filters.sharedWithUsersAny && filters.sharedWithUsersAny.length > 0) {
    extra.push({ sharedWithUsers: { $in: filters.sharedWithUsersAny } });
  }
  if (filters.createdByAny && filters.createdByAny.length > 0) {
    extra.push({ createdBy: { $in: filters.createdByAny } });
  }
  if (filters.systemFilter === "only") {
    extra.push({ isSystemSkill: true });
  } else if (filters.systemFilter === "exclude") {
    // Treat absent / null as "not a system skill" — that's how every
    // pre-feature skill in the registry looks.
    extra.push({ isSystemSkill: { $ne: true } });
  }
  if (filters.nyxidServiceId) {
    extra.push({ nyxidServiceId: filters.nyxidServiceId });
  }
  if (filters.tagsAll && filters.tagsAll.length > 0) {
    // AND-match: every requested tag must be in `metadata.tags`. Mongo's
    // `$all` is the right shape here.
    extra.push({ "metadata.tags": { $all: filters.tagsAll } });
  }
  if (extra.length === 0) return;
  const existingAnd = (matchStage.$and as Array<Record<string, unknown>> | undefined) ?? [];
  matchStage.$and = [...existingAnd, ...extra];
}
