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
  createVersionLoader(actor: ActorContext, forceLatest?: boolean): LoadVersion;
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
  forceLatest = false,
): Promise<DerivedVisibility> {
  const load = skillService.createVersionLoader(SYSTEM_ACTOR, forceLatest);
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
 * Resolve a member-ref list to its EXPORTED snapshot (#1162/#1165): the concrete
 * `name@<major.minor>` of every member that resolves under SYSTEM AND is public
 * (`isPrivate === false`), sorted + de-duped so the snapshot is order-independent
 * and stable.
 *
 * Public-only by design (#1165): the snapshot is the baseline the reactive
 * revision bump diffs against, and a skillset's EXPORTED content is exactly its
 * public-resolvable member subset (#1161). A member going PRIVATE is a
 * visibility change — its resolved VERSION is unchanged, so an all-members
 * snapshot wouldn't move and the revision would never bump — but it DROPS from
 * the exported set, so Claude Code (which detects plugin updates only by the
 * version string) would keep serving the stale bundle. Counting only public
 * members makes a visibility flip move the snapshot → bump the revision →
 * re-export carries the new version. A private or unresolvable member therefore
 * contributes nothing; its appearance / disappearance shows up as a snapshot
 * change → a bump. Single-sourced with the visibility classifier + the mirror's
 * export filter so all three agree on what "in the exported set" means.
 */
export async function computePublicResolvedMembers(
  members: string[],
  skillService: MemberVisibilityResolver,
  forceLatest = false,
): Promise<string[]> {
  const load = skillService.createVersionLoader(SYSTEM_ACTOR, forceLatest);
  const snapshot = new Set<string>();
  for (const ref of members) {
    const node = await load(ref);
    // SYSTEM resolves everything, so `node.isPrivate` faithfully reports the
    // member skill's OWN privacy — the public-export gate, not a read denial.
    if (node && node.isPrivate === false) snapshot.add(`${node.name}@${node.version}`);
  }
  return [...snapshot].sort();
}

/**
 * One-shot boot backfill (#1162): for every existing skillset, populate the
 * resolved-member snapshot on its LATEST version doc when it lacks one (a
 * pre-feature doc). The snapshot is the PUBLIC-resolvable member set (#1165),
 * single-sourced with the reactive bump so create / publish / backfill / bump
 * all compare apples to apples. Existing skillsets keep their current
 * `latestVersion` as the starting revision — only the snapshot is added, so a
 * later member change has a baseline to compare against. Idempotent (skips docs
 * that already carry a snapshot) and failure-isolated per skillset, so one bad
 * member set never aborts boot.
 *
 * Docs that already carry a (pre-#1165, all-members) snapshot are intentionally
 * NOT rewritten here: silently swapping the baseline to the public set would
 * desync the stored revision from the export content with no version bump — the
 * exact bug #1165 fixes. The first reactive event corrects such a doc with a
 * legitimate one-time bump (and is idempotent thereafter).
 */
export async function backfillResolvedMembers(deps: SkillsetRecomputeDeps): Promise<void> {
  const guids = await deps.skillsetRepo.listAllGuids();
  let backfilled = 0;
  for (const guid of guids) {
    try {
      const latest = await deps.skillsetVersionRepo.findLatestBySkillset(guid);
      if (!latest || latest.resolvedMembers !== undefined) continue;
      const snapshot = await computePublicResolvedMembers(latest.members, deps.skillService);
      await deps.skillsetVersionRepo.setResolvedMembers(guid, latest.version, snapshot);
      backfilled += 1;
    } catch (err) {
      logger.error({ guid, err }, "Skillset resolved-members backfill failed; skipping");
    }
  }
  logger.info(
    { total: guids.length, backfilled },
    "Skillset resolved-members backfill complete",
  );
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
  // #1191 — when auto-update is on, classify visibility over the members'
  // LATEST versions (the delivered set), matching how closure/export resolve.
  const identity = await deps.skillsetRepo.findByGuid(guid);
  const forceLatest = identity?.autoUpdateMembers ?? false;
  const derived = await computeDerivedVisibility(latest.members, deps.skillService, forceLatest);
  await deps.skillsetRepo.setDerivedVisibility(guid, derived);
  return derived;
}

/**
 * One-shot boot backfill (#1136): recompute the derived-visibility cache
 * for every existing skillset. Idempotent (recompute is a pure function of
 * the current member set), so it is safe to run on every startup. A single
 * skillset's failure is logged and skipped — one bad/unresolvable member
 * set must not abort the whole backfill or block boot.
 */
export async function backfillDerivedVisibility(deps: SkillsetRecomputeDeps): Promise<void> {
  const guids = await deps.skillsetRepo.listAllGuids();
  let recomputed = 0;
  for (const guid of guids) {
    try {
      const result = await recomputeSkillsetVisibility(guid, deps);
      if (result) recomputed += 1;
    } catch (err) {
      logger.error({ guid, err }, "Skillset derived-visibility backfill failed; skipping");
    }
  }
  logger.info(
    { total: guids.length, recomputed },
    "Skillset derived-visibility backfill complete",
  );
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
