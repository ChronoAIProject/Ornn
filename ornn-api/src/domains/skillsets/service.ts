/**
 * Skillset CRUD + closure service (#969).
 *
 * A skillset is a curated, versioned, visibility-scoped meta-package over
 * N member skills. This service mirrors `SkillService`:
 *   - CRUD with immutable, append-only versioning (publish appends
 *     `guid@version`, advances `latestVersion`; prior versions never
 *     mutate).
 *   - Visibility transitions identical to skills (`setPermissions`).
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
  canReadSkill,
  canWriteSkill,
  canManageSkill,
  isMemberOfOrg,
  SYSTEM_ACTOR,
  type ActorContext,
} from "../skills/crud/authorize";
import type { SkillService } from "../skills/crud/service";
import { isGreater, parseVersion } from "../skills/crud/version";
import { effectiveGrants } from "../skills/crud/grants";
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

export interface SkillsetServiceDeps {
  skillsetRepo: SkillsetRepository;
  skillsetVersionRepo: SkillsetVersionRepository;
  /** Injected to reuse the member-ref loader + closure resolution (#968). */
  skillService: SkillService;
}

export class SkillsetService {
  private readonly skillsetRepo: SkillsetRepository;
  private readonly skillsetVersionRepo: SkillsetVersionRepository;
  private readonly skillService: SkillService;

  constructor(deps: SkillsetServiceDeps) {
    this.skillsetRepo = deps.skillsetRepo;
    this.skillsetVersionRepo = deps.skillsetVersionRepo;
    this.skillService = deps.skillService;
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
    // Publishing a new version is a content/metadata edit — the READ_WRITE
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
    await this.skillsetRepo.update(guid, {
      description,
      kind,
      tags,
      latestVersion: input.version,
      updatedBy: actor.userId,
    });

    logger.info({ guid, version: input.version }, "Skillset version published");
    return this.getSkillset(guid);
  }

  // ==========================================================================
  // Read / delete / permissions
  // ==========================================================================

  /** Read a skillset detail by GUID or name (optionally a specific version). */
  async getSkillset(idOrName: string, version?: string): Promise<SkillsetDetailResponse> {
    const skillset = await this.findByIdOrName(idOrName);
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
    return toDetail(skillset, versionDoc);
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

  /**
   * Replace the permission model in a single write. Mirrors
   * `SkillService.setSkillPermissions` — author/admin only; an owner may
   * only share into orgs they belong to (CWE-862).
   */
  async setPermissions(
    guid: string,
    permissions: { isPrivate: boolean; sharedWithUsers: string[]; sharedWithOrgs: string[] },
    actor: ActorContext,
  ): Promise<SkillsetDetailResponse> {
    const existing = await this.skillsetRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("skillset_not_found", `Skillset '${guid}' not found`);
    }
    if (!canManageSkill(existing, actor)) {
      throw AppError.forbidden("forbidden", "You do not have permission to manage this skillset");
    }

    const sharedWithUsers = Array.from(
      new Set(permissions.sharedWithUsers.filter((id) => id && id !== existing.createdBy)),
    );
    const sharedWithOrgs = Array.from(new Set(permissions.sharedWithOrgs.filter((id) => !!id)));

    if (!actor.isPlatformAdmin) {
      if (sharedWithOrgs.length > 0 && !actor.membershipsResolved) {
        logger.warn({ guid }, "Org membership unresolved; cannot validate share into orgs");
        throw AppError.serviceUnavailable(
          "org_membership_unavailable",
          "Could not verify your organization memberships right now. Retry shortly.",
        );
      }
      const nonMember = sharedWithOrgs.filter((orgId) => !isMemberOfOrg(actor, orgId));
      if (nonMember.length > 0) {
        logger.warn({ guid, nonMember }, "Rejected skillset share into non-member org(s)");
        throw AppError.forbidden(
          "not_org_member",
          "You can only share a skillset into organizations you belong to.",
        );
      }
    }

    await this.skillsetRepo.update(guid, {
      isPrivate: permissions.isPrivate,
      sharedWithUsers,
      sharedWithOrgs,
      updatedBy: actor.userId,
    });
    logger.info({ guid, isPrivate: permissions.isPrivate }, "Skillset permissions changed");
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
    if (!canReadSkill(skillset, actor)) {
      throw AppError.notFound("skillset_not_found", `Skillset '${idOrName}' not found`);
    }

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

function toDetail(
  skillset: SkillsetDocument,
  versionDoc: SkillsetVersionDocument,
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
    // Canonical typed ACL (#1123) — identical shape regardless of migration.
    grants: effectiveGrants(skillset),
    createdOn:
      skillset.createdOn instanceof Date ? skillset.createdOn.toISOString() : String(skillset.createdOn),
    updatedOn:
      skillset.updatedOn instanceof Date ? skillset.updatedOn.toISOString() : String(skillset.updatedOn),
  };
}
