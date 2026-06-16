/**
 * Skillset derived-visibility recompute (#1136).
 *
 * A skillset has NO owner-set visibility — its reach is bounded by its
 * least-privileged member skill. This module derives the denormalized
 * cache (`membersAllPublic` + `memberVisibilityState`) that powers the
 * fast-path discovery filter and the read-only visibility badge, and
 * recomputes it whenever a member skill's privacy changes.
 *
 * Classification is over the skillset's LATEST version's DIRECT member
 * refs, resolved under SYSTEM (so a private member is never hidden from
 * the classifier — it is reported as private, not unresolvable):
 *   - every member resolves AND is public      → "all-public"
 *   - every member resolves, ≥1 is private      → "restricted"
 *   - ≥1 member ref no longer resolves at all    → "unresolvable"
 *
 * Transitive dependencies are intentionally NOT walked here: a public
 * member skill with a private dependency is the member skill's own
 * brokenness (the #968 closure gate already blocks using it), not the
 * skillset's. The skillset is bounded by its direct members.
 *
 * @module domains/skillsets/recompute
 */

import { createLogger } from "../../shared/logger";
import { SYSTEM_ACTOR, type ActorContext } from "../skills/crud/authorize";
import type { LoadVersion } from "../skills/closure/resolver";
import type { SkillsetRepository } from "./repository";
import type { SkillsetVersionRepository } from "./skillsetVersionRepository";
import type { SkillsetMemberVisibilityState } from "./types";

const logger = createLogger("skillsetRecompute");

/**
 * The slice of `SkillService` the recompute needs — just the member-ref
 * loader. Narrowed to an interface so the unit tests can inject a fake
 * resolver without standing up the whole skill service.
 */
export interface MemberVisibilityResolver {
  createVersionLoader(actor: ActorContext): LoadVersion;
}

export interface SkillsetRecomputeDeps {
  skillsetRepo: SkillsetRepository;
  skillsetVersionRepo: SkillsetVersionRepository;
  skillService: MemberVisibilityResolver;
}

export interface DerivedVisibility {
  membersAllPublic: boolean;
  memberVisibilityState: SkillsetMemberVisibilityState;
}

/**
 * Classify a member-ref list into the derived-visibility cache. Resolves
 * each ref under SYSTEM via the shared loader, so the grammar handling
 * (name/guid, version/dist-tag/latest) stays single-sourced with the
 * closure walk. An empty member list is vacuously all-public.
 */
export async function computeDerivedVisibility(
  members: string[],
  skillService: MemberVisibilityResolver,
): Promise<DerivedVisibility> {
  const load = skillService.createVersionLoader(SYSTEM_ACTOR);
  let anyPrivate = false;
  let anyUnresolvable = false;

  for (const ref of members) {
    const node = await load(ref);
    if (!node) {
      // SYSTEM reads everything, so a null means the ref itself no longer
      // resolves (member skill or pinned version hard-gone), not a
      // privacy denial.
      anyUnresolvable = true;
      continue;
    }
    if (node.isPrivate === true) anyPrivate = true;
  }

  if (anyUnresolvable) {
    return { membersAllPublic: false, memberVisibilityState: "unresolvable" };
  }
  if (anyPrivate) {
    return { membersAllPublic: false, memberVisibilityState: "restricted" };
  }
  return { membersAllPublic: true, memberVisibilityState: "all-public" };
}

/**
 * Recompute + persist the derived-visibility cache for a single skillset's
 * latest version. No-op (returns null) if the skillset has no version yet.
 * Returns the freshly computed state so callers can react (e.g. detect an
 * owner losing access).
 */
export async function recomputeSkillsetVisibility(
  guid: string,
  deps: SkillsetRecomputeDeps,
): Promise<DerivedVisibility | null> {
  const latest = await deps.skillsetVersionRepo.findLatestBySkillset(guid);
  if (!latest) {
    logger.debug({ guid }, "Skillset has no version; skipping visibility recompute");
    return null;
  }
  const derived = await computeDerivedVisibility(latest.members, deps.skillService);
  await deps.skillsetRepo.setDerivedVisibility(guid, derived);
  return derived;
}

/**
 * Recompute every skillset that references the given skill as a member.
 * Driven reactively by a skill visibility change (privacy flip, permission
 * change, ownership transfer, nyxid-service change, delete). Returns the
 * affected skillset guids so the caller can run post-recompute work
 * (owner-access-loss notification, #1136 step 8).
 */
export async function recomputeForSkill(
  skillName: string,
  skillGuid: string,
  deps: SkillsetRecomputeDeps,
): Promise<string[]> {
  const guids = await deps.skillsetVersionRepo.findSkillsetGuidsByMember(skillName, skillGuid);
  if (guids.length === 0) {
    logger.debug({ skillName, skillGuid }, "No skillsets reference this skill; nothing to recompute");
    return guids;
  }
  for (const guid of guids) {
    await recomputeSkillsetVisibility(guid, deps);
  }
  logger.info(
    { skillName, skillGuid, affectedCount: guids.length },
    "Recomputed derived visibility for skillsets referencing changed skill",
  );
  return guids;
}
