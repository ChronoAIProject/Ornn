/**
 * Typed access-grant model helpers for skills + skillsets (#1123).
 *
 * Stable, reusable machinery — no I/O, no DB, no request context — so both
 * the skills and skillsets domains (and their authz gates, repositories, and
 * routes) converge on one definition of "what grants does this doc carry"
 * and "how do typed grants map to/from the legacy read-only lists". Keeping
 * it pure mirrors the `scopeFilter.ts` / `authorize.ts` split: business
 * policy lives in the callers, the grant algebra lives here.
 *
 * Back-compat is the load-bearing invariant (#1123): a skill predating typed
 * grants carries only `sharedWithUsers` / `sharedWithOrgs` (read-only). Those
 * MUST resolve to identical READ access, and nobody may be silently
 * escalated to write. `effectiveGrants` and `legacyListsFromGrants` enforce
 * that in both directions.
 *
 * @module domains/skills/crud/grants
 */

import type {
  SkillGrant,
  SkillPermissionLevel,
} from "../../../shared/types/index";

/** The legacy read-only allow-list pair carried by pre-#1123 docs. */
export interface LegacyShareLists {
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
}

/**
 * The fields needed to resolve a doc's effective grants. Both
 * `SkillDocument` and `SkillsetDocument` satisfy this structurally.
 */
export interface GrantSource {
  grants?: SkillGrant[] | undefined;
  sharedWithUsers?: string[] | undefined;
  sharedWithOrgs?: string[] | undefined;
}

/**
 * Resolve the effective typed grants for a skill / skillset.
 *
 * When the doc carries an explicit `grants` array that is the source of
 * truth. Otherwise (legacy / un-migrated doc) derive READ-level grants from
 * the legacy allow-lists so authorization is byte-for-byte identical to the
 * pre-#1123 read-only behaviour.
 */
export function effectiveGrants(src: GrantSource): SkillGrant[] {
  if (Array.isArray(src.grants)) return src.grants;
  return deriveGrantsFromLegacy(src.sharedWithUsers ?? [], src.sharedWithOrgs ?? []);
}

/**
 * Map the legacy read-only allow-lists onto READ-level typed grants. Used by
 * the boot migration and by the read-time fallback. Never produces a
 * `read_write` grant — legacy sharing was read-only, so migrating it must
 * not escalate anyone.
 */
export function deriveGrantsFromLegacy(
  sharedWithUsers: readonly string[],
  sharedWithOrgs: readonly string[],
): SkillGrant[] {
  const out: SkillGrant[] = [];
  for (const id of dedupe(sharedWithUsers)) out.push({ type: "user", id, level: "read" });
  for (const id of dedupe(sharedWithOrgs)) out.push({ type: "org", id, level: "read" });
  return out;
}

/**
 * Project typed grants back onto the legacy read lists for transitional
 * dual-write (#1123). EVERY grant id — regardless of level — lands in the
 * matching legacy list so code that only understands the read lists (an
 * older pod mid-rolling-deploy) still resolves correct READ visibility for
 * read_write grantees, and never escalates anyone to write (old code has no
 * write concept). Dropped by the post-rollout cleanup once all pods read
 * `grants`.
 */
export function legacyListsFromGrants(grants: readonly SkillGrant[]): LegacyShareLists {
  const users: string[] = [];
  const orgs: string[] = [];
  for (const g of grants) {
    if (g.type === "user") users.push(g.id);
    else orgs.push(g.id);
  }
  return { sharedWithUsers: dedupe(users), sharedWithOrgs: dedupe(orgs) };
}

/**
 * Normalize an incoming grants list: trim ids, drop empties, and collapse
 * duplicate `(type, id)` pairs keeping the HIGHEST level (`read_write` wins
 * over `read`) so a principal can never hold two conflicting grants on the
 * same skill. Order is preserved by first appearance.
 */
export function normalizeGrants(grants: readonly SkillGrant[]): SkillGrant[] {
  const order: string[] = [];
  const byKey = new Map<string, SkillGrant>();
  for (const g of grants) {
    const id = (g.id ?? "").trim();
    if (!id) continue;
    const key = `${g.type}:${id}`;
    const prev = byKey.get(key);
    if (!prev) order.push(key);
    const level: SkillPermissionLevel =
      prev?.level === "read_write" || g.level === "read_write" ? "read_write" : "read";
    byKey.set(key, { type: g.type, id, level });
  }
  return order.map((k) => byKey.get(k)!);
}

/** True when `level` permits writing (updating content / metadata). */
export function levelAllowsWrite(level: SkillPermissionLevel): boolean {
  return level === "read_write";
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = (raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
