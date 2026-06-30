/**
 * Skillset CRUD + closure service (#969).
 *
 * A skillset is a curated, versioned, visibility-scoped meta-package over
 * N member skills. This service mirrors `SkillService`:
 *   - CRUD with immutable, append-only versioning (publish appends
 *     `guid@version`, advances `latestVersion`; prior versions never
 *     mutate).
 *   - Visibility is DERIVED from members (#1136), never owner-set — there
 *     is no `setPermissions`; the recompute keeps the cache in sync.
 *   - Publish-time member validation: every member ref must resolve to a
 *     readable skill version, AND each member's own #968 dependency
 *     closure must be conflict-free — reusing the SAME closure resolver.
 *   - One-call closure resolution: `roots = members`, walked through the
 *     injected `SkillService.createVersionLoader`. No forked DFS.
 *
 * `SkillService` is injected (not duplicated) so member resolution +
 * per-node `canReadSkill` visibility gating stays single-sourced with the
 * skill dependency closure.
 *
 * @module domains/skillsets/service
 */

import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/types/index";
import { createLogger } from "../../shared/logger";
import { isReservedVerb } from "../../shared/reservedVerbs";
import { resolveClosure, type ClosureNode } from "../skills/closure/resolver";
import {
  canWriteSkill,
  canManageSkill,
  SYSTEM_ACTOR,
  type ActorContext,
} from "../skills/crud/authorize";
import type { SkillService } from "../skills/crud/service";
import { isGreater, parseVersion } from "../skills/crud/version";
import { effectiveGrants, normalizeGrants } from "../skills/crud/grants";
import { recomputeForSkill, recomputeSkillsetVisibility } from "./recompute";
import type { SkillsetRepository } from "./repository";
import type { SkillsetVersionRepository } from "./skillsetVersionRepository";
import type {
  CreateSkillsetInput,
  PublishSkillsetInput,
  SkillsetDetailResponse,
  SkillsetDocument,
  SkillsetVersionDocument,
} from "./types";

const logger = createLogger("skillsetService");

/**
 * Result of {@link SkillsetService.resolveClosure} (#978) — the resolved
 * delivery closure PLUS the version's master prompt.
 *
 * `instructions` is a ROOT sibling of `items` (NOT folded into the shared
 * `ClosureNode[]` — that resolver + the skill `/skills/:id/closure` path
 * stay clean). Sourced from the already-loaded skillset version document.
 */
export interface SkillsetClosureResult {
  /** The version's master prompt (#978) — surfaced verbatim. */
  instructions: string;
  /** Deps-first topo-sorted closure (the shared #968 node shape). */
  items: ClosureNode[];
}

/**
 * Minimal notification surface the skillset service needs (#1136) — just
 * the owner-side member-unreadable emitter. Narrowed to an interface so the
 * service doesn't depend on the whole NotificationService (and tests can
 * inject a spy).
 */
export interface SkillsetNotificationEmitter {
  notifySkillsetMemberUnreadable(params: {
    ownerUserId: string;
    skillsetGuid: string;
    skillsetName: string;
    unreadableMembers: string[];
  }): Promise<void>;
}

export interface SkillsetServiceDeps {
  skillsetRepo: SkillsetRepository;
  skillsetVersionRepo: SkillsetVersionRepository;
  /** Injected to reuse the member-ref loader + closure resolution (#968). */
  skillService: SkillService;
  /**
   * Resolve a userId to its directory identity (#1123). Used by ownership
   * transfer to validate the target is a known Ornn user. When unset,
   * transfer rejects every target as `invalid_transfer_target`.
   */
  resolveUser?: (
    userId: string,
  ) => Promise<{ userId: string; email: string; displayName: string } | null>;
  /**
   * Owner-notification emitter (#1136). Optional — when unset, the reactive
   * recompute still runs (derived flags update) but no member-unreadable
   * notifications fire. Production bootstrap always wires it.
   */
  notificationService?: SkillsetNotificationEmitter;
}

export class SkillsetService {
  private readonly skillsetRepo: SkillsetRepository;
  private readonly skillsetVersionRepo: SkillsetVersionRepository;
  private readonly skillService: SkillService;
  private readonly resolveUser?:
    | ((userId: string) => Promise<{ userId: string; email: string; displayName: string } | null>)
    | undefined;
  private readonly notificationService?: SkillsetNotificationEmitter | undefined;

  constructor(deps: SkillsetServiceDeps) {
    this.skillsetRepo = deps.skillsetRepo;
    this.skillsetVersionRepo = deps.skillsetVersionRepo;
    this.skillService = deps.skillService;
    this.resolveUser = deps.resolveUser;
    this.notificationService = deps.notificationService;
  }

  // ==========================================================================
  // Create / publish (immutable versioning)
  // ==========================================================================

  /**
   * Create a new skillset (private by default, like skills). Validates the
   * member closure BEFORE any write, seeds the first immutable version,
   * and points `latestVersion` at it.
   */
  async createSkillset(
    input: CreateSkillsetInput,
    actor: { userId: string; email?: string; displayName?: string },
  ): Promise<SkillsetDetailResponse> {
    if (isReservedVerb("skillset", input.name)) {
      throw AppError.badRequest(
        "reserved_name",
        `Skillset name '${input.name}' is reserved — pick a different name`,
      );
    }
    const existing = await this.skillsetRepo.findByName(input.name);
    if (existing) {
      throw AppError.conflict("skillset_name_exists", `Skillset '${input.name}' already exists`);
    }

    const parsed = parseVersion(input.version);
    // Member validation BEFORE any write — every member must resolve to a
    // readable skill version and be closure-conflict-free.
    await this.validateMembers(input.members, { name: input.name, version: input.version });

    const guid = randomUUID();
    await this.skillsetRepo.create({
      guid,
      name: input.name,
      description: input.description,
      kind: input.kind,
      tags: input.tags,
      createdBy: actor.userId,
      createdByEmail: actor.email,
      createdByDisplayName: actor.displayName,
      isPrivate: true,
      // Plugin-export opt-in (#1155) — default OFF at create time.
      exportAsPlugin: input.exportAsPlugin ?? false,
      latestVersion: input.version,
    });
    await this.skillsetVersionRepo.create({
      skillsetGuid: guid,
      version: input.version,
      majorVersion: parsed.major,
      minorVersion: parsed.minor,
      kind: input.kind,
      description: input.description,
      // Master prompt (#978) — straight from input, no carry-forward.
      instructions: input.instructions,
      tags: input.tags,
      members: input.members,
      createdBy: actor.userId,
      createdByEmail: actor.email,
      createdByDisplayName: actor.displayName,
    });

    // Derive the visibility cache from the (just-written) members so a
    // skillset created with a private member is immediately "restricted",
    // not the provisional "all-public" the repo seeds (#1136).
    await this.recomputeVisibility(guid);

    logger.info({ guid, name: input.name, version: input.version, kind: input.kind }, "Skillset created");
    return this.getSkillset(guid);
  }

  /**
   * Publish a new immutable version of an existing skillset. The new
   * version must be strictly greater than the current `latestVersion`
   * — enforced by an explicit strict-increment guard (VERSION_NOT_INCREMENTED)
   * that rejects both equal and lower versions, mirroring the skill publish
   * path. The append-only `guid@version` `_id` is a defence-in-depth backstop
   * for an exact duplicate. Prior versions remain immutable.
   */
  async publishVersion(
    guid: string,
    input: PublishSkillsetInput,
    actor: ActorContext,
  ): Promise<SkillsetDetailResponse> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    // Publishing a new version is a content/metadata edit — the WRITE
    // tier (#1123). Permissions/transfer/delete remain ADMIN-only below.
    if (!canWriteSkill(existing, actor)) {
      throw AppError.forbidden("forbidden", "You do not have permission to update this skillset");
    }

    const parsed = parseVersion(input.version);
    const members = input.members;
    const kind = input.kind ?? existing.kind;
    const description = input.description ?? existing.description;
    const tags = input.tags ?? existing.tags;

    await this.validateMembers(members, { name: existing.name, version: input.version });

    // Enforce strictly-incrementing version BEFORE any write — mirrors the
    // skill publish guard (#969). The append-only `guid@version` `_id` only
    // rejects an EXACT re-publish; without this check a never-used LOWER
    // version (e.g. 1.5 over latest 2.0) would insert a stale version row
    // AND regress `latestVersion` backward, so "latest" consumers silently
    // resolve the downgraded member set. Same VERSION_NOT_INCREMENTED code
    // the skill path emits, covering both lower and equal versions.
    const currentLatest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
    if (currentLatest) {
      const parsedCurrent = parseVersion(currentLatest.version);
      if (!isGreater(parsed, parsedCurrent)) {
        throw AppError.conflict(
          "VERSION_NOT_INCREMENTED",
          `New version '${input.version}' must be strictly greater than the current latest '${currentLatest.version}'.`,
        );
      }
    }

    // Append-only — a duplicate `guid@version` is rejected by the version
    // repo (skillset_version_exists). Prior versions are never touched.
    await this.skillsetVersionRepo.create({
      skillsetGuid: guid,
      version: input.version,
      majorVersion: parsed.major,
      minorVersion: parsed.minor,
      kind,
      description,
      // Master prompt (#978) — REQUIRED on publish, NO carry-forward: each
      // version explicitly carries its own prompt straight from input
      // (unlike `description`/`kind`/`tags`, which inherit when omitted).
      instructions: input.instructions,
      tags,
      members,
      createdBy: actor.userId,
    });

    // Advance the identity doc's cached pointers to the new version.
    // #1155 — `exportAsPlugin` is optional on publish: omitting it preserves
    // the current setting (the repo only writes the field when defined).
    await this.skillsetRepo.update(guid, {
      description,
      kind,
      tags,
      latestVersion: input.version,
      updatedBy: actor.userId,
      ...(input.exportAsPlugin !== undefined ? { exportAsPlugin: input.exportAsPlugin } : {}),
    });

    // The new version's member set may differ from the prior one — rederive
    // the visibility cache against the now-latest version (#1136).
    await this.recomputeVisibility(guid);

    logger.info({ guid, version: input.version }, "Skillset version published");
    return this.getSkillset(guid);
  }

  // ==========================================================================
  // Read / delete / permissions
  // ==========================================================================

  /**
   * Read a skillset detail by GUID or name (optionally a specific version).
   * Performs NO read-gating — used by the write paths (create/publish/
   * transfer) that already authorized the caller, and internally. The
   * member-derived read gate for public reads is {@link getSkillsetForRead}.
   */
  async getSkillset(idOrName: string, version?: string): Promise<SkillsetDetailResponse> {
    const skillset = await this.findByIdOrName(idOrName);
    const versionDoc = await this.loadVersionOrThrow(skillset, version);
    return toDetail(skillset, versionDoc, []);
  }

  /**
   * Read a skillset detail with the member-derived read gate (#1136). A
   * skillset has no owner-set visibility: a caller may read it iff they can
   * read every member skill at the requested version.
   *
   *   - owner / platform admin: ALWAYS see the metadata + members +
   *     `unreadableMembers` (the members THEY can't read), so they can
   *     repair access.
   *   - everyone else: 404 (identical to a missing skillset) the moment any
   *     member is unreadable — never revealing WHICH member is private.
   */
  async getSkillsetForRead(
    idOrName: string,
    actor: ActorContext,
    version?: string,
  ): Promise<SkillsetDetailResponse> {
    const skillset = await this.findByIdOrName(idOrName);
    const versionDoc = await this.loadVersionOrThrow(skillset, version);

    const isOwnerOrAdmin = canManageSkill(skillset, actor);
    const unreadableMembers = await this.resolveUnreadableMembers(versionDoc.members, actor);

    if (!isOwnerOrAdmin && unreadableMembers.length > 0) {
      // No leak: a non-owner who can't read every member sees a flat 404,
      // never which member (or that one even exists).
      throw AppError.notFound("skillset_not_found", `Skillset '${idOrName}' not found`);
    }
    return toDetail(skillset, versionDoc, unreadableMembers);
  }

  /**
   * Live discovery predicate (#1136): can `actor` read EVERY member of the
   * skillset's latest version? Used by the search service to live-filter
   * restricted candidates into a caller's browse/search results. A skillset
   * with no published version, or any unreadable/unresolvable member, is not
   * discoverable.
   */
  async canDiscoverSkillset(skillset: SkillsetDocument, actor: ActorContext): Promise<boolean> {
    const latest = await this.skillsetVersionRepo.findLatestBySkillset(skillset.guid);
    if (!latest) return false;
    const unreadable = await this.resolveUnreadableMembers(latest.members, actor);
    return unreadable.length === 0;
  }

  /**
   * Latest-version member refs + master prompt for the plugin-export mirror
   * (#1155). Returns `null` when the skillset has no published version. The
   * mirror resolves the member refs to concrete skill packages itself (under
   * SYSTEM via the shared loader), so this only surfaces the raw refs + the
   * README-bound master prompt — no closure walk here.
   */
  async getLatestForMirror(
    guid: string,
  ): Promise<{ members: string[]; instructions: string } | null> {
    const latest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
    if (!latest) return null;
    return { members: latest.members, instructions: latest.instructions };
  }

  /** List all published versions, newest first. */
  async listVersions(idOrName: string): Promise<
    Array<{
      version: string;
      kind: SkillsetVersionDocument["kind"];
      memberCount: number;
      createdBy: string;
      createdByEmail?: string | undefined;
      createdByDisplayName?: string | undefined;
      createdOn: string;
    }>
  > {
    const skillset = await this.findByIdOrName(idOrName);
    const versions = await this.skillsetVersionRepo.listBySkillset(skillset.guid);
    return versions.map((v) => ({
      version: v.version,
      kind: v.kind,
      memberCount: v.members.length,
      createdBy: v.createdBy,
      createdByEmail: v.createdByEmail,
      createdByDisplayName: v.createdByDisplayName,
      createdOn: v.createdOn instanceof Date ? v.createdOn.toISOString() : String(v.createdOn),
    }));
  }

  /** Delete a skillset + all its versions. Caller must be author/admin. */
  async deleteSkillset(guid: string, actor: ActorContext): Promise<void> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    if (!canManageSkill(existing, actor)) {
      throw AppError.forbidden("forbidden", "You do not have permission to delete this skillset");
    }
    await this.skillsetVersionRepo.deleteAllBySkillset(guid);
    await this.skillsetRepo.hardDelete(guid);
    logger.info({ guid }, "Skillset deleted");
  }

  // NOTE (#1136): there is deliberately NO setPermissions. A skillset has
  // no owner-set visibility — its reach is derived from its members
  // (`memberVisibilityState`). To widen it, expose the member skills.

  /**
   * Transfer skillset ownership to another user (#1123). Mirrors
   * `SkillService.transferSkillOwnership`, but — because the skillset routes
   * delegate authorization to the service — this method owns the full flow:
   * ADMIN gate (`canManageSkill`), no-op rejection (`ownership_conflict`),
   * target validation against the directory (`invalid_transfer_target`,
   * resolved internally so a non-owner can't enumerate users), then the
   * mutation (reassign `createdBy`, refresh labels, keep the prior owner as
   * a READ grantee, drop the new owner from any prior grant).
   */
  async transferOwnership(
    guid: string,
    newOwnerUserId: string,
    actor: ActorContext,
  ): Promise<SkillsetDetailResponse> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    if (!canManageSkill(existing, actor)) {
      throw AppError.forbidden(
        "forbidden",
        "Only the skillset owner or a platform admin can transfer ownership",
      );
    }
    if (newOwnerUserId === existing.createdBy) {
      throw AppError.conflict("ownership_conflict", "This user already owns the skillset");
    }

    const target = this.resolveUser ? await this.resolveUser(newOwnerUserId) : null;
    if (!target) {
      throw AppError.badRequest(
        "invalid_transfer_target",
        "Transfer target is not a known Ornn user. They must have signed in to Ornn at least once.",
      );
    }

    const priorOwner = existing.createdBy;
    const grants = normalizeGrants([
      ...effectiveGrants(existing).filter(
        (g) => !(g.type === "user" && g.id === target.userId),
      ),
      { type: "user", id: priorOwner, level: "read" },
    ]);

    await this.skillsetRepo.transferOwnership(guid, {
      newOwnerId: target.userId,
      newOwnerEmail: target.email,
      newOwnerDisplayName: target.displayName,
      grants,
      updatedBy: actor.userId,
    });
    logger.info(
      { guid, priorOwner, newOwnerId: target.userId, by: actor.userId },
      "Skillset ownership transferred",
    );
    return this.getSkillset(guid);
  }

  // ==========================================================================
  // Closure (one-call resolve — roots = members)
  // ==========================================================================

  /**
   * Resolve the full delivery closure of a skillset version (#969): the
   * union of all member skills PLUS each member's #968 dependency closure,
   * deduplicated + topo-sorted (deps-first), PLUS the version's master
   * prompt (#978).
   *
   * Reuses the #968 resolver directly — `roots = members`, walked through
   * the injected `SkillService.createVersionLoader(actor)`. The loader's
   * per-node `canReadSkill` gate means an anonymous caller resolving a
   * PUBLIC skillset whose member transitively pins a PRIVATE skill gets
   * `skill_dependency_not_found` (no leak), inheriting the exact codes the
   * skill closure uses.
   *
   * The master prompt is sourced from the SAME already-loaded `versionDoc`
   * — no extra read — and returned alongside `items` so the route can emit
   * it as a root sibling. This is the SKILLSET closure result type; the
   * shared `ClosureNode[]`/`resolveClosure` resolver and the skill
   * `/skills/:id/closure` path stay untouched (#978).
   */
  async resolveClosure(
    idOrName: string,
    actor: ActorContext,
    version?: string,
  ): Promise<SkillsetClosureResult> {
    const skillset = await this.findByIdOrName(idOrName);
    // No standalone skillset read gate (#1136): the per-member loader below
    // enforces visibility node-by-node. A member the actor can't read makes
    // the resolver throw `skill_dependency_not_found` (404, no leak) — the
    // skillset is bounded by its least-privileged member.

    const resolvedVersion =
      version === undefined || version.length === 0 ? skillset.latestVersion : version;
    parseVersion(resolvedVersion);

    const versionDoc = await this.skillsetVersionRepo.findBySkillsetAndVersion(
      skillset.guid,
      resolvedVersion,
    );
    if (!versionDoc) {
      throw AppError.notFound(
        "skillset_version_not_found",
        `Version '${resolvedVersion}' not found for skillset '${skillset.name}'`,
      );
    }

    const roots = versionDoc.members;
    const items = await resolveClosure(roots, {
      loadVersion: this.skillService.createVersionLoader(actor),
    });
    logger.info(
      { idOrName, version: resolvedVersion, memberCount: roots.length, nodeCount: items.length },
      "Skillset closure resolved",
    );
    return { instructions: versionDoc.instructions, items };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Rederive the denormalized visibility cache for a skillset's latest
   * version (#1136). Called on the skillset write path (create/publish);
   * the skill write path drives the same recompute reactively via
   * `recomputeForSkill`.
   */
  private async recomputeVisibility(guid: string): Promise<void> {
    await recomputeSkillsetVisibility(guid, {
      skillsetRepo: this.skillsetRepo,
      skillsetVersionRepo: this.skillsetVersionRepo,
      skillService: this.skillService,
    });
  }

  /**
   * Reactive entry point (#1136) for a skill visibility change (privacy
   * flip, permission change, ownership transfer, nyxid-service bind,
   * delete). Recomputes the derived-visibility cache for every skillset
   * referencing the skill, then — for each affected skillset whose OWNER the
   * change cost member-read access — fires a one-per-skillset owner
   * notification.
   *
   * Owner-readability is computed best-effort: a background task triggered
   * by another user's request has no way to resolve the skillset owner's
   * org memberships, so the owner actor carries none (`membershipsResolved:
   * false`, read fails soft). Org-granted access therefore can't be
   * confirmed here — the skillset page recomputes the authoritative set
   * under the owner's own token. To avoid re-notifying on unrelated member
   * changes, a notification fires only when the JUST-CHANGED skill is among
   * the owner's now-unreadable members.
   */
  async recomputeForChangedSkill(changedSkill: { guid: string; name: string }): Promise<void> {
    const affected = await recomputeForSkill(changedSkill.name, changedSkill.guid, {
      skillsetRepo: this.skillsetRepo,
      skillsetVersionRepo: this.skillsetVersionRepo,
      skillService: this.skillService,
    });
    if (!this.notificationService || affected.length === 0) return;

    for (const guid of affected) {
      const skillset = await this.skillsetRepo.findByGuid(guid);
      if (!skillset) continue;
      const latest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
      if (!latest) continue;

      const ownerActor: ActorContext = {
        userId: skillset.createdBy,
        memberships: [],
        isPlatformAdmin: false,
        membershipsResolved: false,
      };
      const unreadable = await this.resolveUnreadableMembers(latest.members, ownerActor);
      if (unreadable.length === 0) continue;
      // Notify only when THIS change is what cost the owner access.
      const changedNowUnreadable = unreadable.some((ref) =>
        refTargetsSkill(ref, changedSkill.name, changedSkill.guid),
      );
      if (!changedNowUnreadable) continue;

      await this.notificationService.notifySkillsetMemberUnreadable({
        ownerUserId: skillset.createdBy,
        skillsetGuid: guid,
        skillsetName: skillset.name,
        unreadableMembers: unreadable,
      });
      logger.info(
        { skillsetGuid: guid, ownerUserId: skillset.createdBy, unreadableCount: unreadable.length },
        "Notified skillset owner of member-access loss",
      );
    }
  }

  /** Load a skillset's requested (or latest) version doc, or 404. */
  private async loadVersionOrThrow(
    skillset: SkillsetDocument,
    version?: string,
  ): Promise<SkillsetVersionDocument> {
    const resolvedVersion =
      version === undefined || version.length === 0 ? skillset.latestVersion : version;
    const versionDoc = await this.skillsetVersionRepo.findBySkillsetAndVersion(
      skillset.guid,
      resolvedVersion,
    );
    if (!versionDoc) {
      throw AppError.notFound(
        "skillset_version_not_found",
        `Version '${resolvedVersion}' not found for skillset '${skillset.name}'`,
      );
    }
    return versionDoc;
  }

  /**
   * The direct member refs `actor` cannot read (#1136). Each ref is resolved
   * under the actor via the shared loader — `null` means unreadable (the
   * `canReadSkill` gate) OR no longer resolvable (deleted skill/version),
   * both of which the owner needs surfaced to repair. Single-sourced with
   * the closure walk's per-node gate, so the read gate can never drift from
   * actual usability.
   */
  private async resolveUnreadableMembers(
    members: string[],
    actor: ActorContext,
  ): Promise<string[]> {
    const load = this.skillService.createVersionLoader(actor);
    const unreadable: string[] = [];
    for (const ref of members) {
      const node = await load(ref);
      if (!node) unreadable.push(ref);
    }
    return unreadable;
  }

  private async findByIdOrName(idOrName: string): Promise<SkillsetDocument> {
    let skillset = await this.skillsetRepo.findByGuid(idOrName);
    if (!skillset) {
      skillset = await this.skillsetRepo.findByName(idOrName);
    }
    if (!skillset) {
      throw AppError.notFound("skillset_not_found", `Skillset '${idOrName}' not found`);
    }
    return skillset;
  }

  /**
   * Publish-time member validation (#969). Resolves the full closure of
   * the member refs as `SYSTEM_ACTOR` (mirrors
   * `SkillService.validatePublishDependencies`): every member must resolve
   * to an existing, readable skill version, and the union closure must be
   * conflict-free. A missing / unresolvable member surfaces as
   * `skill_dependency_not_found`; a cross-member version collision as
   * `dependency_conflict`; a cycle as `dependency_cycle`.
   *
   * Runs as SYSTEM so a curator may legitimately bundle a private skill
   * they own / were granted — the route layer scopes the closure READ
   * separately.
   */
  private async validateMembers(
    members: string[],
    context: { name: string; version: string },
  ): Promise<void> {
    await resolveClosure(members, {
      loadVersion: this.skillService.createVersionLoader(SYSTEM_ACTOR),
    });
    logger.info(
      { name: context.name, version: context.version, memberCount: members.length },
      "Publish-time skillset members validated",
    );
  }
}

/**
 * Whether a member ref points at the given skill (#1136). Member refs are
 * `<name-or-guid>@<version|dist-tag>`, so the ref targets the skill iff it
 * begins with `<name>@` or `<guid>@` — the `@` boundary prevents a prefix
 * name (`rev`) from matching a longer one (`review@1.0`).
 */
function refTargetsSkill(ref: string, skillName: string, skillGuid: string): boolean {
  return ref.startsWith(`${skillName}@`) || ref.startsWith(`${skillGuid}@`);
}

function toDetail(
  skillset: SkillsetDocument,
  versionDoc: SkillsetVersionDocument,
  unreadableMembers: string[],
): SkillsetDetailResponse {
  return {
    guid: skillset.guid,
    name: skillset.name,
    description: versionDoc.description,
    // Master prompt (#978) — surfaced verbatim from the loaded version.
    instructions: versionDoc.instructions,
    kind: versionDoc.kind,
    tags: versionDoc.tags,
    members: versionDoc.members,
    version: versionDoc.version,
    latestVersion: skillset.latestVersion,
    isPrivate: skillset.isPrivate,
    createdBy: skillset.createdBy,
    createdByEmail: skillset.createdByEmail,
    createdByDisplayName: skillset.createdByDisplayName,
    sharedWithUsers: skillset.sharedWithUsers,
    sharedWithOrgs: skillset.sharedWithOrgs,
    // Inert legacy ACL (#1123/#1136) — kept for back-compat; visibility is
    // now derived from members, surfaced via `memberVisibilityState`.
    grants: effectiveGrants(skillset),
    // Derived visibility (#1136) — the authoritative signal for the badge.
    memberVisibilityState: skillset.memberVisibilityState ?? "all-public",
    // Plugin-export opt-in (#1155).
    exportAsPlugin: skillset.exportAsPlugin ?? false,
    unreadableMembers,
    createdOn:
      skillset.createdOn instanceof Date ? skillset.createdOn.toISOString() : String(skillset.createdOn),
    updatedOn:
      skillset.updatedOn instanceof Date ? skillset.updatedOn.toISOString() : String(skillset.updatedOn),
  };
}
