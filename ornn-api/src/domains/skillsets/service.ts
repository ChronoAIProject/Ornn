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
import { parseVersion } from "../skills/crud/version";
import { effectiveGrants, normalizeGrants } from "../skills/crud/grants";
import {
  computePublicResolvedMembers,
  recomputeForSkill,
  recomputeSkillsetVisibility,
} from "./recompute";
import type { SkillsetRepository } from "./repository";
import type { SkillsetVersionRepository } from "./skillsetVersionRepository";
import {
  SKILLSET_INITIAL_REVISION,
  SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS,
  type AutoUpdateInput,
  type CreateSkillsetInput,
  type PluginExportInput,
  type PublishSkillsetInput,
  type SkillsetDetailResponse,
  type SkillsetDocument,
  type SkillsetPluginOverrides,
  type SkillsetVersionDocument,
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
   * member closure BEFORE any write, seeds the first immutable revision
   * ({@link SKILLSET_INITIAL_REVISION}) with its resolved-member snapshot, and
   * points `latestVersion` at it. The revision is system-assigned (#1162) — the
   * owner never types a version.
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

    const version = SKILLSET_INITIAL_REVISION;
    const parsed = parseVersion(version);
    // Member validation BEFORE any write — every member must resolve to a
    // readable skill version and be closure-conflict-free.
    await this.validateMembers(input.members, { name: input.name, version });
    // Snapshot the members resolved to concrete versions so this revision is
    // reproducible even when its authored refs pin `@latest`/dist-tags (#1162).
    const resolvedMembers = await this.resolveMemberSnapshot(input.members);

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
      // Plugin-export opt-in (#1155/#1157) — always OFF at create; enabling it
      // is a deliberate post-create action via PUT /skillsets/:id/plugin-export.
      exportAsPlugin: false,
      latestVersion: version,
    });
    await this.skillsetVersionRepo.create({
      skillsetGuid: guid,
      version,
      majorVersion: parsed.major,
      minorVersion: parsed.minor,
      kind: input.kind,
      description: input.description,
      // Master prompt (#978) — straight from input, no carry-forward.
      instructions: input.instructions,
      tags: input.tags,
      members: input.members,
      resolvedMembers,
      createdBy: actor.userId,
      createdByEmail: actor.email,
      createdByDisplayName: actor.displayName,
    });

    // Derive the visibility cache from the (just-written) members so a
    // skillset created with a private member is immediately "restricted",
    // not the provisional "all-public" the repo seeds (#1136).
    await this.recomputeVisibility(guid);

    logger.info({ guid, name: input.name, version, kind: input.kind }, "Skillset created");
    return this.getSkillset(guid);
  }

  /**
   * Publish a new immutable revision of an existing skillset. The owner no
   * longer types a version (#1162) — the system auto-bumps the MINOR off the
   * current latest (`1.0 → 1.1 → 1.2 …`; major never auto-bumps), writing a new
   * immutable version doc with a fresh resolved-member snapshot. Prior versions
   * remain immutable. The append-only `guid@version` `_id` is a defence-in-depth
   * backstop against a concurrent double-publish landing the same minor.
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

    const members = input.members;
    const kind = input.kind ?? existing.kind;
    const description = input.description ?? existing.description;
    const tags = input.tags ?? existing.tags;

    // System-assigned revision: bump the minor off the current latest. Every
    // owner publish is a qualifying change, so it always advances (no
    // idempotency guard here — that guards only the reactive member-driven bump).
    const currentLatest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
    const next = nextRevision(currentLatest?.version ?? existing.latestVersion);

    await this.validateMembers(members, { name: existing.name, version: next.version });
    // #1191 — when auto-update is on, snapshot the members at their latest so
    // the exported/delivered set matches the "always up to date" promise.
    const resolvedMembers = await this.resolveMemberSnapshot(
      members,
      existing.autoUpdateMembers ?? false,
    );

    // Append-only — a duplicate `guid@version` is rejected by the version
    // repo (skillset_version_exists). Prior versions are never touched.
    await this.skillsetVersionRepo.create({
      skillsetGuid: guid,
      version: next.version,
      majorVersion: next.major,
      minorVersion: next.minor,
      kind,
      description,
      // Master prompt (#978) — REQUIRED on publish, NO carry-forward: each
      // version explicitly carries its own prompt straight from input
      // (unlike `description`/`kind`/`tags`, which inherit when omitted).
      instructions: input.instructions,
      tags,
      members,
      resolvedMembers,
      createdBy: actor.userId,
    });

    // Advance the identity doc's cached pointers to the new version. Plugin
    // export (#1157) is a separate concern, mutated only by the dedicated
    // endpoint — a publish never touches `exportAsPlugin` / `pluginConfig`.
    await this.skillsetRepo.update(guid, {
      description,
      kind,
      tags,
      latestVersion: next.version,
      updatedBy: actor.userId,
    });

    // The new version's member set may differ from the prior one — rederive
    // the visibility cache against the now-latest version (#1136).
    await this.recomputeVisibility(guid);

    logger.info({ guid, version: next.version }, "Skillset revision published");
    return this.getSkillset(guid);
  }

  /**
   * Enable / disable plugin export and persist the owner's listing overrides
   * (#1157). The opt-in is a deliberate, configurable action — NOT a create /
   * publish side effect. Owner/admin only (WRITE tier, mirroring publish).
   *
   * Enabling requires the skillset have at least
   * {@link SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS} public, resolvable members (#1161)
   * — the export bundles only that public subset, so a restricted skillset (one
   * private member) may still export as long as enough public members remain; a
   * request to enable a skillset below the floor is rejected. The overrides
   * (`displayName` / `description` / `keywords`) are stored only when provided;
   * an empty set clears them so the mirror falls back to the skillset's own name
   * / description / tags. Disabling is always allowed and clears the overrides.
   */
  async setPluginExport(
    guid: string,
    input: PluginExportInput,
    actor: ActorContext,
  ): Promise<SkillsetDetailResponse> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    if (!canWriteSkill(existing, actor)) {
      throw AppError.forbidden(
        "forbidden",
        "You do not have permission to manage plugin export for this skillset",
      );
    }

    if (input.enabled) {
      // Only the public-member subset is ever bundled, so a private member never
      // leaks — but a plugin under the floor is too thin to be a meaningful set.
      // Count the latest version's public members under SYSTEM and gate on it.
      const latest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
      const publicCount = latest
        ? await this.countPublicMembers(latest.members, existing.autoUpdateMembers ?? false)
        : 0;
      if (publicCount < SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS) {
        throw AppError.conflict(
          "skillset_too_few_public_members",
          `A skillset needs at least ${SKILLSET_MIN_PUBLIC_EXPORT_MEMBERS} public member skills to export as a plugin.`,
        );
      }
    }

    const overrides = input.enabled ? buildPluginOverrides(input) : null;
    await this.skillsetRepo.update(guid, {
      exportAsPlugin: input.enabled,
      // `null` clears the stored overrides; an object replaces them.
      pluginConfig: overrides,
      updatedBy: actor.userId,
    });

    logger.info(
      { guid, enabled: input.enabled, hasOverrides: overrides !== null },
      "Skillset plugin export updated",
    );
    return this.getSkillset(guid);
  }

  /**
   * Enable/disable "always keep skills in this skillset up to date" (#1191).
   * When ON, every member (pinned or not) resolves to its skill's latest
   * version wherever the set is delivered — closure, plugin export, snapshot,
   * visibility. Flipping the flag either way changes the effective resolved
   * set, so we immediately re-cut the revision when the public snapshot moved
   * and refresh derived visibility (both idempotent no-ops when nothing
   * changed); the route then fires the mirror reconcile to re-export the plugin
   * at the freshly-bumped revision. Requires WRITE (author/admin, #1123).
   */
  async setAutoUpdateMembers(
    guid: string,
    input: AutoUpdateInput,
    actor: ActorContext,
  ): Promise<SkillsetDetailResponse> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    if (!canWriteSkill(existing, actor)) {
      throw AppError.forbidden(
        "forbidden",
        "You do not have permission to manage auto-update for this skillset",
      );
    }

    await this.skillsetRepo.update(guid, {
      autoUpdateMembers: input.enabled,
      updatedBy: actor.userId,
    });

    // Immediate catch-up: the effective resolved-member set just changed (pins
    // now float to latest, or revert to their pins), so re-cut the revision if
    // the public snapshot moved and refresh the derived-visibility cache.
    await this.maybeBumpRevisionForMemberChange(guid);
    await this.recomputeVisibility(guid);

    logger.info({ guid, enabled: input.enabled }, "Skillset auto-update-members updated");
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
    return this.buildDetail(skillset, versionDoc, []);
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
    const unreadableMembers = await this.resolveUnreadableMembers(
      versionDoc.members,
      actor,
      skillset.autoUpdateMembers ?? false,
    );

    if (!isOwnerOrAdmin && unreadableMembers.length > 0) {
      // No leak: a non-owner who can't read every member sees a flat 404,
      // never which member (or that one even exists).
      throw AppError.notFound("skillset_not_found", `Skillset '${idOrName}' not found`);
    }
    return this.buildDetail(skillset, versionDoc, unreadableMembers);
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

    // #1191 — deliver each member at its latest when auto-update is on, so a
    // consumer resolving the skillset gets the up-to-date set, not the pins.
    const roots = versionDoc.members;
    const items = await resolveClosure(roots, {
      loadVersion: this.skillService.createVersionLoader(
        actor,
        skillset.autoUpdateMembers ?? false,
      ),
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
      const unreadable = await this.resolveUnreadableMembers(
        latest.members,
        ownerActor,
        skillset.autoUpdateMembers ?? false,
      );
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

  /**
   * Reactive revision bump (#1162/#1165) for a member skill whose EXPORTED
   * contribution may have moved — either its resolved version (new-version
   * publish, GitHub refresh, dist-tag set/delete) OR its visibility (a privacy
   * flip that adds/removes it from the public-resolvable set, #1165). Finds
   * EVERY skillset that references the changed skill — exported or not, since the
   * revision is the skillset's OWN version — and, for each, re-cuts a new
   * revision ONLY when the public-resolved-member snapshot actually changed from
   * the latest revision's baseline.
   *
   * Ordering (#1162): bootstrap invokes this BEFORE the mirror's targeted
   * re-export (`syncSkillsetsForMember`) inside one fire-and-forget handler, so
   * an exported plugin always picks up the freshly-bumped revision rather than
   * racing two independent hooks. Idempotent + failure-isolated per skillset: a
   * no-op member sync (snapshot unchanged) creates NO revision, so the mirror's
   * deterministic no-op-commit skip still holds.
   */
  async bumpRevisionsForChangedMember(changedSkill: { guid: string; name: string }): Promise<void> {
    const guids = await this.skillsetVersionRepo.findSkillsetGuidsByMember(
      changedSkill.name,
      changedSkill.guid,
    );
    if (guids.length === 0) {
      logger.debug(
        { skillName: changedSkill.name },
        "No skillsets reference this skill; nothing to bump",
      );
      return;
    }
    let bumped = 0;
    for (const guid of guids) {
      try {
        if (await this.maybeBumpRevisionForMemberChange(guid)) bumped += 1;
      } catch (err) {
        logger.error({ guid, err }, "Skillset revision bump failed; skipping");
      }
    }
    logger.info(
      { skillName: changedSkill.name, referencing: guids.length, bumped },
      "Skillset reactive revision bump complete",
    );
  }

  /**
   * Re-cut a skillset's revision iff its public-resolved-member snapshot changed
   * (#1162/#1165). Returns `true` when a new revision was written. Compares the
   * current public-resolvable members (under SYSTEM) against the latest
   * revision's stored snapshot:
   *   - snapshot identical → no-op (idempotency guard, no churn).
   *   - snapshot missing (pre-feature doc the backfill hasn't reached) →
   *     populate it in place, no bump (no baseline to diff against).
   *   - snapshot moved → write a new minor-bumped revision carrying forward the
   *     same authored members/metadata + the new snapshot, then advance the
   *     pointer WITHOUT touching the audit timestamps (a member-driven change,
   *     not an owner edit).
   *
   * A member going private/public is a snapshot move (#1165), so this is what
   * makes an exported plugin's version bump when its public member subset
   * changes — the bootstrap sequences this BEFORE the targeted re-export, so the
   * re-exported plugin.json carries the freshly-bumped revision. A doc still
   * carrying a pre-#1165 all-members snapshot self-corrects with one legitimate
   * bump on its first reactive event, then is idempotent.
   */
  private async maybeBumpRevisionForMemberChange(guid: string): Promise<boolean> {
    const latest = await this.skillsetVersionRepo.findLatestBySkillset(guid);
    if (!latest) return false;

    // #1191 — resolve the snapshot with the skillset's own auto-update setting
    // so a pinned member's new version still moves the snapshot (and bumps the
    // revision) when the owner asked to always track latest.
    const identity = await this.skillsetRepo.findByGuid(guid);
    const currentSnapshot = await this.resolveMemberSnapshot(
      latest.members,
      identity?.autoUpdateMembers ?? false,
    );

    if (latest.resolvedMembers === undefined) {
      // Defensive backfill: no baseline yet, so record one rather than bump.
      await this.skillsetVersionRepo.setResolvedMembers(guid, latest.version, currentSnapshot);
      return false;
    }
    if (snapshotsEqual(latest.resolvedMembers, currentSnapshot)) return false;

    const next = nextRevision(latest.version);
    await this.skillsetVersionRepo.create({
      skillsetGuid: guid,
      version: next.version,
      majorVersion: next.major,
      minorVersion: next.minor,
      kind: latest.kind,
      description: latest.description,
      // Carry the prior revision's prompt/metadata forward verbatim — only the
      // RESOLVED member versions moved; the authored member refs are unchanged.
      instructions: latest.instructions,
      tags: latest.tags,
      members: latest.members,
      resolvedMembers: currentSnapshot,
      createdBy: latest.createdBy,
    });
    await this.skillsetRepo.advanceLatestVersion(guid, next.version);
    logger.info(
      { guid, from: latest.version, to: next.version },
      "Skillset revision auto-bumped on member-version change",
    );
    return true;
  }

  /**
   * Resolve member refs to the EXPORTED snapshot (#1162/#1165). Thin instance
   * wrapper over the shared {@link computePublicResolvedMembers} so create /
   * publish / reactive-bump all snapshot members the same way: the SYSTEM loader,
   * sorted + de-duped concrete `name@<major.minor>` of the PUBLIC-resolvable
   * subset only. Public-only means a member's visibility flip (private⇄public)
   * moves the snapshot and bumps the revision, in addition to a version move.
   */
  private async resolveMemberSnapshot(
    members: string[],
    autoUpdateMembers = false,
  ): Promise<string[]> {
    return computePublicResolvedMembers(members, this.skillService, autoUpdateMembers);
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
    autoUpdateMembers = false,
  ): Promise<string[]> {
    const load = this.skillService.createVersionLoader(actor, autoUpdateMembers);
    const unreadable: string[] = [];
    for (const ref of members) {
      const node = await load(ref);
      if (!node) unreadable.push(ref);
    }
    return unreadable;
  }

  /**
   * Count the PUBLIC, resolvable members of a version under SYSTEM (#1161),
   * de-duped by skill name. A member is public iff it resolves AND its skill's
   * `isPrivate === false`. Single-sourced with the mirror's export filter so the
   * detail-surfaced count + the opt-in gate agree with what actually gets
   * bundled. Resolved as SYSTEM so a member's own privacy — not the caller's
   * read access — decides public-ness.
   */
  private async countPublicMembers(
    members: string[],
    autoUpdateMembers = false,
  ): Promise<number> {
    const load = this.skillService.createVersionLoader(SYSTEM_ACTOR, autoUpdateMembers);
    const publicNames = new Set<string>();
    for (const ref of members) {
      const node = await load(ref);
      if (node && node.isPrivate === false) publicNames.add(node.name);
    }
    return publicNames.size;
  }

  /**
   * Serialize a skillset detail, computing the public-member count (#1161) so
   * the response carries it for the web export-card gate. The count is over the
   * RETURNED version's members (latest by default), matching the `members` array
   * in the same response.
   */
  private async buildDetail(
    skillset: SkillsetDocument,
    versionDoc: SkillsetVersionDocument,
    unreadableMembers: string[],
  ): Promise<SkillsetDetailResponse> {
    const publicMemberCount = await this.countPublicMembers(
      versionDoc.members,
      skillset.autoUpdateMembers ?? false,
    );
    return toDetail(skillset, versionDoc, unreadableMembers, publicMemberCount);
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

/**
 * The next auto-bumped skillset revision (#1162): keep the major, increment the
 * minor (`1.0 → 1.1`, `2.3 → 2.4`). Major never auto-bumps — chosen to keep the
 * `<major>.<minor>` shape so the `guid@<version>` doc-id / dist-tag /
 * `SKILL_VERSION_REGEX` grammar is unchanged.
 */
function nextRevision(current: string): { version: string; major: number; minor: number } {
  const parsed = parseVersion(current);
  const minor = parsed.minor + 1;
  return { version: `${parsed.major}.${minor}`, major: parsed.major, minor };
}

/**
 * Order-independent equality of two resolved-member snapshots (#1162). Both are
 * produced sorted by {@link computePublicResolvedMembers}, so a positional
 * compare is sufficient and cheap — this is the idempotency guard that stops a
 * no-op member sync from churning a new revision.
 */
function snapshotsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Collapse the plugin-export request's optional override fields (#1157) into a
 * compact overrides object, dropping empty/whitespace values so the mirror
 * cleanly falls back to the skillset's own fields. Returns `null` when nothing
 * meaningful was supplied (so the repo `$unset`s any prior overrides).
 */
function buildPluginOverrides(input: PluginExportInput): SkillsetPluginOverrides | null {
  const out: SkillsetPluginOverrides = {};
  const displayName = input.displayName?.trim();
  const description = input.description?.trim();
  if (displayName) out.displayName = displayName;
  if (description) out.description = description;
  if (input.keywords && input.keywords.length > 0) out.keywords = input.keywords;
  return Object.keys(out).length > 0 ? out : null;
}

function toDetail(
  skillset: SkillsetDocument,
  versionDoc: SkillsetVersionDocument,
  unreadableMembers: string[],
  publicMemberCount: number,
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
    // Plugin-export opt-in (#1155) + owner listing overrides (#1157).
    exportAsPlugin: skillset.exportAsPlugin ?? false,
    // Auto-update-members opt-in (#1191).
    autoUpdateMembers: skillset.autoUpdateMembers ?? false,
    pluginConfig: skillset.pluginConfig,
    // Public-member subset size (#1161) — drives the export-card gate.
    publicMemberCount,
    unreadableMembers,
    createdOn:
      skillset.createdOn instanceof Date ? skillset.createdOn.toISOString() : String(skillset.createdOn),
    updatedOn:
      skillset.updatedOn instanceof Date ? skillset.updatedOn.toISOString() : String(skillset.updatedOn),
  };
}
