/**
 * Skill CRUD service. Uses chrono-storage via StorageClient (bucket-based API).
 * Replaces direct S3 access. Uses storageKey instead of s3Url.
 * @module domains/skills/crud/service
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { SkillRepository } from "./repository";
import type { SkillVersionRepository } from "./skillVersionRepository";
import type { IStorageClient } from "../../../clients/storageClient";
import type { SkillDocument, SkillMetadata, SkillDetailResponse, SkillVersionDocument, SkillSource } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";
import { fetchSkillFromGitHub, parseGithubUrl, type GitHubPullInput } from "./utils/githubPull";
import { computeVersionDiff, type VersionDiffResult } from "./utils/versionDiff";
import { isReservedVerb } from "../../../shared/reservedVerbs";
import { validateSkillFrontmatter } from "../../../shared/schemas/skillFrontmatter";
import { resolveZipRoot } from "../../../shared/utils/zip";
import { parseVersion, isGreater } from "./version";
import { diffSkillInterface, type InterfaceChange } from "./interfaceDiff";
import { parse as parseYaml } from "yaml";
import JSZip from "jszip";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillCrudService" });

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

/**
 * Versioned storage key layout: `skills/{guid}/{version}.zip`.
 * Keeps every published version as its own immutable blob.
 * Legacy, pre-migration skills may still live at `skills/{guid}.zip`; the
 * migration script preserves that key when backfilling a version row.
 */
function buildVersionedStorageKey(guid: string, version: string): string {
  return `skills/${guid}/${version}.zip`;
}

function formatInterfaceChanges(changes: InterfaceChange[]): string {
  return changes.map((c) => `${c.field} ${c.kind} ${c.detail}`).join("; ");
}

export interface SkillServiceDeps {
  skillRepo: SkillRepository;
  skillVersionRepo: SkillVersionRepository;
  storageClient: IStorageClient;
  storageBucket: string;
}

export class SkillService {
  private readonly skillRepo: SkillRepository;
  private readonly skillVersionRepo: SkillVersionRepository;
  private readonly storageClient: IStorageClient;
  private readonly storageBucket: string;

  constructor(deps: SkillServiceDeps) {
    this.skillRepo = deps.skillRepo;
    this.skillVersionRepo = deps.skillVersionRepo;
    this.storageClient = deps.storageClient;
    this.storageBucket = deps.storageBucket;
  }

  async createSkill(
    zipBuffer: Uint8Array,
    userId: string,
    options?: {
      skipValidation?: boolean;
      userEmail?: string;
      userDisplayName?: string;
      /** Origin metadata stamped on the skill doc when created from an external pull. */
      source?: import("../../../shared/types/index").SkillSource;
    },
  ): Promise<{ guid: string }> {
    // 1. Validate ZIP format rules
    if (!options?.skipValidation) {
      const violations = await this.validateZipFormat(zipBuffer);
      if (violations.length > 0) {
        throw AppError.badRequest(
          "VALIDATION_FAILED",
          violations.map((v) => `[${v.rule}] ${v.message}`).join("; "),
        );
      }
    }

    // 2. Parse SKILL.md from ZIP
    const { name, description, version, license, compatibility, metadata, releaseNotes } = await this.extractSkillInfo(zipBuffer);
    const parsedVersion = parseVersion(version);

    // 3a. Reject reserved-verb names — would collide with `/v1/skills/{verb}`
    //     action paths and make the skill unreachable via the canonical read.
    if (isReservedVerb("skill", name)) {
      throw AppError.badRequest(
        "RESERVED_NAME",
        `Skill name '${name}' is reserved — pick a different name`,
      );
    }

    // 3b. Check name uniqueness
    const existing = await this.skillRepo.findByName(name);
    if (existing) {
      throw AppError.conflict("SKILL_NAME_EXISTS", `Skill '${name}' already exists`);
    }

    // 4. Generate GUID and hash
    const guid = randomUUID();
    const skillHash = createHash("sha256").update(zipBuffer).digest("hex");

    // 5. Upload ZIP to chrono-storage under a versioned key (versions are immutable).
    const storageKey = buildVersionedStorageKey(guid, version);
    await this.storageClient.upload(this.storageBucket, storageKey, zipBuffer, "application/zip");
    logger.info({ guid, storageKey, version }, "Skill package uploaded to storage");

    // 6. Save the skill document.
    await this.skillRepo.create({
      guid,
      name,
      description,
      license: license ?? undefined,
      compatibility: compatibility ?? undefined,
      metadata,
      skillHash,
      storageKey,
      // `ownerId` is retained as a no-op field for back-compat. New skills
      // always record the author here; visibility is expressed via
      // sharedWithUsers/sharedWithOrgs on the skill doc.
      ownerId: userId,
      createdBy: userId,
      createdByEmail: options?.userEmail,
      createdByDisplayName: options?.userDisplayName,
      isPrivate: true,
      latestVersion: version,
      source: options?.source,
    });

    // 7. Record the initial version row.
    await this.skillVersionRepo.create({
      skillGuid: guid,
      version,
      majorVersion: parsedVersion.major,
      minorVersion: parsedVersion.minor,
      storageKey,
      skillHash,
      metadata,
      license,
      compatibility,
      createdBy: userId,
      createdByEmail: options?.userEmail,
      createdByDisplayName: options?.userDisplayName,
      releaseNotes,
    });

    return { guid };
  }

  /**
   * Read a skill. Without `version` returns the latest (the skill doc's
   * cached pointer). With `version`, reads from the `skill_versions` collection
   * and overlays that version's storageKey / metadata / hash on the identity
   * fields from the skill doc.
   */
  async getSkill(idOrName: string, version?: string): Promise<SkillDetailResponse> {
    const skill = await this.findSkillByIdOrName(idOrName);
    if (version !== undefined) {
      // Validate format early so clients get a clear 400, not a 404.
      parseVersion(version);
      const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, version);
      if (!versionDoc) {
        throw AppError.notFound("SKILL_VERSION_NOT_FOUND", `Version '${version}' not found for skill '${skill.name}'`);
      }
      return this.buildDetailResponse(skill, versionDoc);
    }
    return this.buildDetailResponse(skill);
  }

  /**
   * List every published version for a skill, newest first. Includes the
   * deprecation flag + note so consumers can render a warning without another
   * round-trip.
   */
  async listSkillVersions(idOrName: string): Promise<Array<{
    version: string;
    skillHash: string;
    createdBy: string;
    createdByEmail?: string;
    createdByDisplayName?: string;
    createdOn: string;
    isDeprecated: boolean;
    deprecationNote: string | null;
    releaseNotes: string | null;
  }>> {
    const skill = await this.findSkillByIdOrName(idOrName);
    const versions = await this.skillVersionRepo.listBySkill(skill.guid);
    return versions.map((v) => ({
      version: v.version,
      skillHash: v.skillHash,
      createdBy: v.createdBy,
      createdByEmail: v.createdByEmail,
      createdByDisplayName: v.createdByDisplayName,
      createdOn: v.createdOn instanceof Date ? v.createdOn.toISOString() : String(v.createdOn),
      isDeprecated: v.isDeprecated === true,
      deprecationNote: v.deprecationNote ?? null,
      releaseNotes: v.releaseNotes ?? null,
    }));
  }

  /**
   * Mutate the deprecation flag on a single version. Caller is responsible
   * for the owner/admin auth gate — we only validate the target exists.
   *
   * Returns a lightweight view; callers that need the full version doc can
   * subsequently call `getSkill(idOrName, version)`.
   */
  async setVersionDeprecation(
    idOrName: string,
    version: string,
    isDeprecated: boolean,
    deprecationNote: string | null | undefined,
  ): Promise<{
    skillGuid: string;
    skillName: string;
    version: string;
    isDeprecated: boolean;
    deprecationNote: string | null;
  }> {
    // Validate version format up-front so clients get 400 rather than 404.
    parseVersion(version);
    const skill = await this.findSkillByIdOrName(idOrName);
    const updated = await this.skillVersionRepo.setDeprecation(
      skill.guid,
      version,
      isDeprecated,
      deprecationNote ?? null,
    );
    return {
      skillGuid: skill.guid,
      skillName: skill.name,
      version: updated.version,
      isDeprecated: updated.isDeprecated === true,
      deprecationNote: updated.deprecationNote ?? null,
    };
  }

  private async findSkillByIdOrName(idOrName: string): Promise<SkillDocument> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) {
      skill = await this.skillRepo.findByName(idOrName);
    }
    if (!skill) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
    }
    return skill;
  }

  /**
   * Replace the per-skill permission model in a single atomic write. The
   * route layer has already enforced the write gate (author/admin); the
   * service just validates the inputs and persists them.
   *
   * Ownership (`createdBy`, `ownerId`) is left untouched — permissions
   * don't change who wrote or "owns" the skill, they just widen who can
   * read it.
   */
  async setSkillPermissions(
    guid: string,
    userId: string,
    permissions: {
      isPrivate: boolean;
      sharedWithUsers: string[];
      sharedWithOrgs: string[];
    },
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    // System-skill invariant: a skill tied to an admin NyxID service is
    // always public. Reject attempts to flip it back to private without
    // first untying — keeps the "system skill ⇒ visible to everyone"
    // mental model tight.
    if (existing.isSystemSkill === true && permissions.isPrivate === true) {
      throw AppError.badRequest(
        "SYSTEM_SKILL_MUST_BE_PUBLIC",
        "This skill is tied to an admin NyxID service and must remain public. Untie the service before making it private.",
      );
    }

    // Dedupe the lists + drop any self-references. The author always has
    // access; including their id in `sharedWithUsers` is redundant and
    // noisy for downstream debugging.
    const sharedWithUsers = Array.from(
      new Set(permissions.sharedWithUsers.filter((id) => id && id !== existing.createdBy)),
    );
    const sharedWithOrgs = Array.from(
      new Set(permissions.sharedWithOrgs.filter((id) => !!id)),
    );

    const updated = await this.skillRepo.update(guid, {
      isPrivate: permissions.isPrivate,
      sharedWithUsers,
      sharedWithOrgs,
      updatedBy: userId,
    });
    return this.buildDetailResponse(updated);
  }

  async updateSkill(
    guid: string,
    userId: string,
    options: {
      zipBuffer?: Uint8Array;
      isPrivate?: boolean;
      skipValidation?: boolean;
      userEmail?: string;
      userDisplayName?: string;
      /** Refresh-from-source path stamps this so lastSyncedAt/Commit move forward. */
      source?: import("../../../shared/types/index").SkillSource;
    },
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    // System-skill invariant — same as setSkillPermissions. Block
    // `PUT /skills/:id` body that flips a system skill private.
    if (
      existing.isSystemSkill === true &&
      options.isPrivate === true
    ) {
      throw AppError.badRequest(
        "SYSTEM_SKILL_MUST_BE_PUBLIC",
        "This skill is tied to an admin NyxID service and must remain public. Untie the service before making it private.",
      );
    }

    const updateData: Record<string, unknown> = { updatedBy: userId };

    if (options.zipBuffer) {
      if (!options.skipValidation) {
        const violations = await this.validateZipFormat(options.zipBuffer);
        if (violations.length > 0) {
          throw AppError.badRequest(
            "VALIDATION_FAILED",
            violations.map((v) => `[${v.rule}] ${v.message}`).join("; "),
          );
        }
      }

      const { name, description, version, license, compatibility, metadata, releaseNotes } = await this.extractSkillInfo(options.zipBuffer);
      const parsedNewVersion = parseVersion(version);

      // Enforce strictly-incrementing version on every package update.
      const currentLatest = await this.skillVersionRepo.findLatestBySkill(guid);
      if (currentLatest) {
        const parsedCurrent = parseVersion(currentLatest.version);
        if (!isGreater(parsedNewVersion, parsedCurrent)) {
          throw AppError.conflict(
            "VERSION_NOT_INCREMENTED",
            `New version '${version}' must be strictly greater than the current latest '${currentLatest.version}'. Bump the version in SKILL.md.`,
          );
        }
        // Breaking-change check: any interface diff requires a major bump.
        const changes = diffSkillInterface(currentLatest.metadata, metadata);
        if (changes.length > 0 && parsedNewVersion.major === parsedCurrent.major) {
          throw AppError.conflict(
            "BREAKING_CHANGE_WITHOUT_MAJOR_BUMP",
            `Detected breaking interface change(s) between ${currentLatest.version} and ${version}. ` +
              `A major-version bump is required for: ${formatInterfaceChanges(changes)}. ` +
              `Either revert the change or bump the major version in SKILL.md.`,
          );
        }
      }

      const skillHash = createHash("sha256").update(options.zipBuffer).digest("hex");

      // Upload under a new, versioned storage key — versions are immutable.
      const storageKey = buildVersionedStorageKey(guid, version);
      await this.storageClient.upload(this.storageBucket, storageKey, options.zipBuffer, "application/zip");
      logger.info({ guid, storageKey, version }, "Skill package updated in storage");

      // Record the new version row.
      await this.skillVersionRepo.create({
        skillGuid: guid,
        version,
        majorVersion: parsedNewVersion.major,
        minorVersion: parsedNewVersion.minor,
        storageKey,
        skillHash,
        metadata,
        license,
        compatibility,
        createdBy: userId,
        createdByEmail: options.userEmail,
        createdByDisplayName: options.userDisplayName,
        releaseNotes,
      });

      Object.assign(updateData, {
        name,
        description,
        license,
        compatibility,
        metadata,
        skillHash,
        storageKey,
        latestVersion: version,
      });
    }

    if (options.isPrivate !== undefined) {
      updateData.isPrivate = options.isPrivate;
    }

    if (options.source !== undefined) {
      updateData.source = options.source;
    }

    const updated = await this.skillRepo.update(guid, updateData as any);
    return this.buildDetailResponse(updated);
  }

  /**
   * Pull a skill package from a public GitHub repo and publish it as a new
   * skill. Returns the created skill's GUID + the source manifest that was
   * stamped on the doc so callers can show "linked to X".
   *
   * Distinct from `createSkill` because the caller doesn't provide the ZIP —
   * this method builds it from the repo contents via
   * {@link fetchSkillFromGitHub} and then hands off to `createSkill` with
   * the source stamped.
   */
  async createSkillFromGitHub(
    input: GitHubPullInput,
    userId: string,
    options?: { userEmail?: string; userDisplayName?: string; skipValidation?: boolean },
  ): Promise<{ guid: string; source: SkillSource }> {
    const pulled = await fetchSkillFromGitHub(input);
    const source: SkillSource = {
      type: "github",
      repo: pulled.source.repo,
      ref: pulled.source.ref,
      path: pulled.source.path,
      lastSyncedAt: new Date(),
      lastSyncedCommit: pulled.resolvedCommitSha,
    };
    const { guid } = await this.createSkill(pulled.zipBuffer, userId, {
      skipValidation: options?.skipValidation,
      userEmail: options?.userEmail,
      userDisplayName: options?.userDisplayName,
      source,
    });
    return { guid, source };
  }

  /**
   * Re-pull the skill's stored GitHub source and publish the fetched package
   * as a new version. Fails if the skill has no `source` or the source is
   * not of type `github`.
   */
  async refreshSkillFromSource(
    guid: string,
    userId: string,
    options?: { userEmail?: string; userDisplayName?: string; skipValidation?: boolean },
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }
    if (!existing.source || existing.source.type !== "github") {
      throw AppError.badRequest(
        "NO_SOURCE",
        "Skill has no linked GitHub source; use POST /api/v1/skills/pull to create a new linked skill",
      );
    }

    const pulled = await fetchSkillFromGitHub({
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
    });

    const newSource: SkillSource = {
      type: "github",
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
      lastSyncedAt: new Date(),
      lastSyncedCommit: pulled.resolvedCommitSha,
    };

    return this.updateSkill(guid, userId, {
      zipBuffer: pulled.zipBuffer,
      skipValidation: options?.skipValidation,
      userEmail: options?.userEmail,
      userDisplayName: options?.userDisplayName,
      source: newSource,
    });
  }

  /**
   * Attach (or clear) a GitHub source pointer on an existing skill without
   * pulling. Lets a user link an originally-uploaded skill to its GitHub
   * source first and trigger the actual sync separately. Pass `null` to
   * unlink. The pointer is parsed from a GitHub URL (e.g.
   * `https://github.com/owner/repo/tree/<ref>/<path>`); `lastSyncedAt` /
   * `lastSyncedCommit` are intentionally absent until the first refresh.
   */
  async setSkillSource(
    guid: string,
    githubUrl: string | null,
    userId: string,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    if (githubUrl === null) {
      await this.skillRepo.clearSource(guid, userId);
      return this.getSkill(guid);
    }

    let parsed: { repo: string; ref?: string; path?: string };
    try {
      parsed = parseGithubUrl(githubUrl);
    } catch (err) {
      throw AppError.badRequest(
        "INVALID_GITHUB_URL",
        err instanceof Error ? err.message : String(err),
      );
    }

    const newSource: SkillSource = {
      type: "github",
      repo: parsed.repo,
      ref: parsed.ref ?? "HEAD",
      path: parsed.path ?? "",
    };

    await this.skillRepo.update(guid, { source: newSource, updatedBy: userId });
    return this.getSkill(guid);
  }

  /**
   * Dry-run a refresh: pull the latest content from the skill's stored
   * GitHub source, compute a structured diff against the current latest
   * version, and return the diff without persisting anything. Drives the
   * "preview-then-confirm" UI flow on the detail-page advanced settings.
   *
   * Throws NO_SOURCE if the skill has no `source`. Throws PULL_FAILED with
   * a useful message if the upstream folder no longer exists / responds.
   */
  async previewRefreshFromSource(guid: string): Promise<{
    skill: { guid: string; name: string };
    source: SkillSource;
    pendingVersion: string;
    hasChanges: boolean;
    diff: VersionDiffResult;
  }> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }
    if (!existing.source || existing.source.type !== "github") {
      throw AppError.badRequest(
        "NO_SOURCE",
        "Skill has no linked GitHub source. Link one via PUT /api/v1/skills/:id/source first.",
      );
    }

    const pulled = await fetchSkillFromGitHub({
      repo: existing.source.repo,
      ref: existing.source.ref,
      path: existing.source.path,
    });

    const latestVersionDoc = await this.skillVersionRepo.findBySkillAndVersion(
      existing.guid,
      existing.latestVersion,
    );
    if (!latestVersionDoc) {
      throw AppError.internalError(
        "MISSING_VERSION",
        `Latest version '${existing.latestVersion}' has no version row`,
      );
    }
    const latestZip = await this.downloadPackage(latestVersionDoc.storageKey);
    const diff = await computeVersionDiff(latestZip, pulled.zipBuffer);

    const hasChanges =
      diff.files.added.length > 0 ||
      diff.files.removed.length > 0 ||
      diff.files.modified.length > 0;

    // Predict what the next version label will be. The actual bump
    // happens inside `updateSkill` from the SKILL.md frontmatter, which
    // is what the user already edited in the GitHub repo. We extract it
    // out of the pulled ZIP so the UI can show "you'll create v1.2".
    let pendingVersion = existing.latestVersion;
    try {
      const info = await this.extractSkillInfo(pulled.zipBuffer);
      pendingVersion = info.version;
    } catch {
      // If the package can't be parsed (e.g. malformed frontmatter),
      // fall back to the existing latest. The actual sync will surface
      // the validation error properly.
    }

    return {
      skill: { guid: existing.guid, name: existing.name },
      source: { ...existing.source, lastSyncedCommit: pulled.resolvedCommitSha },
      pendingVersion,
      hasChanges,
      diff,
    };
  }

  /**
   * Compute a structured diff between two versions of a skill.
   *
   * Downloads both version ZIPs from storage, extracts, and compares
   * file-level (added / removed / modified). For text files the diff
   * includes both sides' contents so the UI can render side-by-side or
   * any line-level diff it wants client-side.
   *
   * Throws NOT_FOUND when the skill or either version is unknown; throws
   * BAD_REQUEST when `from` and `to` are the same.
   */
  async diffVersions(
    idOrName: string,
    fromVersion: string,
    toVersion: string,
  ): Promise<{
    skill: { guid: string; name: string };
    from: { version: string; hash: string; createdOn: string; isDeprecated: boolean; releaseNotes: string | null };
    to: { version: string; hash: string; createdOn: string; isDeprecated: boolean; releaseNotes: string | null };
    diff: VersionDiffResult;
  }> {
    if (fromVersion === toVersion) {
      throw AppError.badRequest(
        "SAME_VERSION",
        `'from' and 'to' refer to the same version '${fromVersion}'`,
      );
    }

    const skill = await this.findSkillByIdOrName(idOrName);

    parseVersion(fromVersion);
    parseVersion(toVersion);

    const [fromDoc, toDoc] = await Promise.all([
      this.skillVersionRepo.findBySkillAndVersion(skill.guid, fromVersion),
      this.skillVersionRepo.findBySkillAndVersion(skill.guid, toVersion),
    ]);
    if (!fromDoc) {
      throw AppError.notFound(
        "SKILL_VERSION_NOT_FOUND",
        `Version '${fromVersion}' not found for skill '${skill.name}'`,
      );
    }
    if (!toDoc) {
      throw AppError.notFound(
        "SKILL_VERSION_NOT_FOUND",
        `Version '${toVersion}' not found for skill '${skill.name}'`,
      );
    }

    const [fromZip, toZip] = await Promise.all([
      this.downloadPackage(fromDoc.storageKey),
      this.downloadPackage(toDoc.storageKey),
    ]);

    const diff = await computeVersionDiff(fromZip, toZip);

    return {
      skill: { guid: skill.guid, name: skill.name },
      from: {
        version: fromDoc.version,
        hash: fromDoc.skillHash,
        createdOn:
          fromDoc.createdOn instanceof Date
            ? fromDoc.createdOn.toISOString()
            : String(fromDoc.createdOn),
        isDeprecated: fromDoc.isDeprecated === true,
        releaseNotes: fromDoc.releaseNotes ?? null,
      },
      to: {
        version: toDoc.version,
        hash: toDoc.skillHash,
        createdOn:
          toDoc.createdOn instanceof Date
            ? toDoc.createdOn.toISOString()
            : String(toDoc.createdOn),
        isDeprecated: toDoc.isDeprecated === true,
        releaseNotes: toDoc.releaseNotes ?? null,
      },
      diff,
    };
  }

  private async downloadPackage(storageKey: string): Promise<Uint8Array> {
    const presigned = await this.storageClient.getPresignedUrl(
      this.storageBucket,
      storageKey,
    );
    const res = await fetch(presigned.presignedUrl);
    if (!res.ok) {
      throw AppError.internalError(
        "PACKAGE_DOWNLOAD_FAILED",
        `Failed to download package for key '${storageKey}' (HTTP ${res.status})`,
      );
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * Delete a single non-latest version. Constraints:
   *   - The version must exist.
   *   - Cannot delete the **only** version on the skill — the caller should
   *     use `DELETE /skills/:id` for that.
   *   - Cannot delete the **current latest** version — moving the latest
   *     pointer is a write that touches the skill doc and isn't worth the
   *     complexity for a UI prune; ask the owner to publish a new latest
   *     first if they really need to remove what's currently latest.
   * Storage is best-effort cleaned up; failures are logged but do not roll
   * back the version row deletion.
   */
  async deleteVersion(idOrName: string, version: string): Promise<void> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) skill = await this.skillRepo.findByName(idOrName);
    if (!skill) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
    }
    const versionDoc = await this.skillVersionRepo.findBySkillAndVersion(skill.guid, version);
    if (!versionDoc) {
      throw AppError.notFound(
        "SKILL_VERSION_NOT_FOUND",
        `Version '${version}' not found for skill '${skill.name}'`,
      );
    }
    const allVersions = await this.skillVersionRepo.listBySkill(skill.guid);
    if (allVersions.length <= 1) {
      throw AppError.conflict(
        "SKILL_VERSION_LAST",
        `Cannot delete the only remaining version of '${skill.name}'. Delete the whole skill instead.`,
      );
    }
    // `listBySkill` returns versions sorted latest-first, so index 0 is the
    // current latest pointer. Forbid deleting it; owner must publish a
    // newer version first.
    const latest = allVersions[0]!;
    if (latest.version === version) {
      throw AppError.conflict(
        "SKILL_VERSION_LATEST",
        `Cannot delete v${version}: it is the current latest. Publish a newer version first, then delete v${version}.`,
      );
    }

    if (versionDoc.storageKey) {
      try {
        await this.storageClient.delete(this.storageBucket, versionDoc.storageKey);
      } catch (err) {
        logger.warn(
          { skillGuid: skill.guid, version, storageKey: versionDoc.storageKey, err },
          "Best-effort version-storage cleanup failed",
        );
      }
    }
    await this.skillVersionRepo.deleteOne(skill.guid, version);
    logger.info({ skillGuid: skill.guid, version }, "Skill version deleted");
  }

  /**
   * Tie or untie a skill to a NyxID service. `serviceId === null` clears
   * the tie and leaves `isPrivate` alone. When tying to a service:
   *
   * - The route layer has already verified the caller can manage the
   *   skill (author or platform admin).
   * - This method validates that the caller is **eligible** to use the
   *   target service: either it's an admin/platform service
   *   (`visibility: "public"`) the caller can see, or it's a private
   *   service the caller created (`created_by === caller.userId`).
   * - If the target is an admin service, `isPrivate` is forced to
   *   `false` atomically. Personal ties leave `isPrivate` alone.
   *
   * The `lookupService` callback is passed in so the route layer can
   * inject a `NyxidServiceClient` without the service module taking a
   * direct dependency on it. Returns the refreshed `SkillDetailResponse`.
   */
  async tieToNyxidService(
    guid: string,
    serviceId: string | null,
    actor: { userId: string; isPlatformAdmin: boolean },
    lookupService: (id: string) => Promise<{
      id: string;
      slug: string;
      label: string;
      visibility: "public" | "private";
      createdBy: string;
    } | null>,
  ): Promise<SkillDetailResponse> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    // Untie path — wipe all four cached fields, leave `isPrivate` alone.
    if (serviceId === null) {
      const updated = await this.skillRepo.setNyxidService(guid, {
        nyxidServiceId: null,
        nyxidServiceSlug: null,
        nyxidServiceLabel: null,
        isSystemSkill: false,
        updatedBy: actor.userId,
      });
      return this.buildDetailResponse(updated);
    }

    const service = await lookupService(serviceId);
    if (!service) {
      throw AppError.notFound(
        "NYXID_SERVICE_NOT_FOUND",
        `NyxID service '${serviceId}' not found or not visible to caller`,
      );
    }

    const isAdminService = service.visibility === "public";
    const isCallerOwnedPersonal =
      service.visibility === "private" && service.createdBy === actor.userId;

    // Eligibility: admin service (anyone can tie) OR own personal service.
    // Tying to *another user's* personal service is rejected even for
    // platform admins — the spec's #4 explicitly limits admins to "his
    // own personal nyxid service or any admin nyxid services".
    if (!isAdminService && !isCallerOwnedPersonal) {
      throw AppError.forbidden(
        "NYXID_SERVICE_NOT_ELIGIBLE",
        "Caller is not eligible to tie this skill to that NyxID service",
      );
    }

    const updated = await this.skillRepo.setNyxidService(guid, {
      nyxidServiceId: service.id,
      nyxidServiceSlug: service.slug,
      nyxidServiceLabel: service.label,
      isSystemSkill: isAdminService,
      // Admin tie forces public; personal tie leaves privacy alone.
      isPrivate: isAdminService ? false : undefined,
      updatedBy: actor.userId,
    });
    return this.buildDetailResponse(updated);
  }

  async deleteSkill(guid: string): Promise<void> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    // Collect every storage key to clean up: the current pointer on the skill
    // doc plus each versioned key in the skill_versions collection. Using a
    // Set dedupes the overlap between the two.
    const versions = await this.skillVersionRepo.listBySkill(guid);
    const storageKeys = new Set<string>();
    if (existing.storageKey) storageKeys.add(existing.storageKey);
    for (const v of versions) {
      if (v.storageKey) storageKeys.add(v.storageKey);
    }

    for (const key of storageKeys) {
      try {
        await this.storageClient.delete(this.storageBucket, key);
      } catch (err) {
        logger.warn({ guid, storageKey: key, err }, "Best-effort storage cleanup failed");
      }
    }
    logger.info({ guid, storageKeys: Array.from(storageKeys) }, "Skill package(s) deleted from storage");

    // Cascade-delete version rows first, then the skill doc.
    await this.skillVersionRepo.deleteAllBySkill(guid);
    await this.skillRepo.hardDelete(guid);
  }

  /**
   * Return the full skill package as a JSON object with all file contents.
   * Used by playground to inject skill context.
   */
  async getSkillJson(idOrName: string): Promise<{
    name: string;
    description: string;
    metadata: Record<string, unknown>;
    files: Record<string, string>;
  }> {
    // 1. Get skill doc
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) {
      skill = await this.skillRepo.findByName(idOrName);
    }
    if (!skill) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
    }

    // 2. Download ZIP from storage
    const presigned = await this.storageClient.getPresignedUrl(this.storageBucket, skill.storageKey);
    const response = await fetch(presigned.presignedUrl);
    if (!response.ok) {
      throw AppError.internalError("PACKAGE_DOWNLOAD_FAILED", "Failed to download skill package from storage");
    }
    const zipBuffer = new Uint8Array(await response.arrayBuffer());

    // 3. Extract all files
    const zip = await JSZip.loadAsync(zipBuffer);
    const allPaths = Object.keys(zip.files);
    const { rootEntries: _rootEntries } = resolveZipRoot(zip, allPaths);

    const files: Record<string, string> = {};

    // Walk all entries and extract text content
    for (const path of allPaths) {
      const entry = zip.files[path];
      if (entry.dir) continue;

      // Get the relative path (strip root folder prefix if present)
      let relativePath = path;
      const parts = path.split("/");
      if (parts.length > 1) {
        // Check if first part is the root folder
        const possibleRoot = parts[0] + "/";
        if (zip.files[possibleRoot]?.dir) {
          relativePath = parts.slice(1).join("/");
        }
      }

      if (!relativePath) continue;

      try {
        const content = await entry.async("string");
        files[relativePath] = content;
      } catch {
        logger.warn({ path: relativePath }, "Could not extract file as text, skipping");
      }
    }

    logger.info({ skillName: skill.name, fileCount: Object.keys(files).length }, "Skill jsonized");

    return {
      name: skill.name,
      description: skill.description,
      metadata: skill.metadata as unknown as Record<string, unknown>,
      files,
    };
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async extractSkillInfo(zipBuffer: Uint8Array): Promise<{
    name: string;
    description: string;
    version: string;
    license: string | null;
    compatibility: string | null;
    metadata: SkillMetadata;
    /** Optional author-supplied changelog. Read from SKILL.md frontmatter `release-notes` or `releaseNotes`. Max 2000 chars. */
    releaseNotes: string | null;
  }> {
    const zip = await JSZip.loadAsync(zipBuffer);
    const allPaths = Object.keys(zip.files);
    const { getFile } = resolveZipRoot(zip, allPaths);

    const skillMdEntry = getFile("SKILL.md");
    if (!skillMdEntry) {
      throw AppError.badRequest("MISSING_SKILL_MD", "SKILL.md not found in package");
    }

    const content = await skillMdEntry.async("string");
    const fmMatch = content.match(FRONTMATTER_REGEX);
    if (!fmMatch) {
      throw AppError.badRequest("MISSING_FRONTMATTER", "SKILL.md must have a frontmatter section");
    }

    let rawFrontmatter: Record<string, unknown>;
    try {
      const parsed = parseYaml(fmMatch[1]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Frontmatter must be a YAML object");
      }
      rawFrontmatter = parsed as Record<string, unknown>;
    } catch (err) {
      throw AppError.badRequest(
        "INVALID_FRONTMATTER",
        `Invalid frontmatter YAML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Validate with Zod schema (no backward compat adapter)
    const validation = validateSkillFrontmatter(rawFrontmatter);
    if (!validation.success) {
      const errorMsg = validation.errors.map((e) => `${e.field}: ${e.message}`).join("; ");
      throw AppError.badRequest("FRONTMATTER_VALIDATION_FAILED", errorMsg);
    }

    const fm = validation.data;
    const rawMeta = fm.metadata;

    // Build SkillMetadata from validated frontmatter
    const metadata: SkillMetadata = {
      category: rawMeta.category,
    };

    if (rawMeta["output-type"]) {
      metadata.outputType = rawMeta["output-type"];
    }

    if (rawMeta.runtime.length > 0) {
      // Map flat runtime strings to the structured runtimes array
      // Parse runtime-dependency and runtime-env-var into the first runtime entry
      metadata.runtimes = rawMeta.runtime.map((r) => ({
        runtime: r,
        dependencies: rawMeta["runtime-dependency"].map((dep) => ({
          library: dep,
          version: "*",
        })),
        envs: rawMeta["runtime-env-var"].map((envVar) => ({
          var: envVar,
          description: "",
        })),
      }));
    }

    if (rawMeta["tool-list"].length > 0) {
      metadata.tools = rawMeta["tool-list"].map((t) => ({
        tool: t,
        type: "mcp",
      }));
    }

    if (rawMeta.tag.length > 0) {
      metadata.tags = rawMeta.tag;
    }

    // Author-supplied changelog lives next to the formal frontmatter but isn't
    // part of the Zod schema — kept permissive so missing/older SKILL.md files
    // just report null instead of hard-failing. Accepts either `release-notes`
    // (kebab-case to match other frontmatter fields) or `releaseNotes`.
    const rawReleaseNotes =
      rawFrontmatter["release-notes"] ?? rawFrontmatter["releaseNotes"];
    let releaseNotes: string | null = null;
    if (typeof rawReleaseNotes === "string" && rawReleaseNotes.trim().length > 0) {
      const trimmed = rawReleaseNotes.trim();
      releaseNotes = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
    }

    return {
      name: fm.name,
      description: fm.description,
      version: fm.version,
      license: fm.license ?? null,
      compatibility: fm.compatibility ?? null,
      metadata,
      releaseNotes,
    };
  }

  private async buildDetailResponse(
    skill: SkillDocument,
    versionOverlay?: SkillVersionDocument,
  ): Promise<SkillDetailResponse> {
    // When reading a specific version, swap in that version's package fields;
    // identity fields (name, createdBy, isPrivate, ...) still come from the
    // skill doc.
    //
    // For the latest-read path (no overlay), we do one extra lookup against
    // `skill_versions` so the response can still surface `isDeprecated` /
    // `deprecationNote` consistently with the versioned path. If this becomes
    // a hot-path bottleneck we can denormalize those two fields onto the
    // skill doc later (TODO).
    let effectiveOverlay = versionOverlay;
    if (!effectiveOverlay) {
      effectiveOverlay =
        (await this.skillVersionRepo.findLatestBySkill(skill.guid)) ?? undefined;
    }

    const storageKey = effectiveOverlay?.storageKey ?? skill.storageKey;
    const metadata = effectiveOverlay?.metadata ?? skill.metadata;
    const skillHash = effectiveOverlay?.skillHash ?? skill.skillHash;
    const license = effectiveOverlay ? effectiveOverlay.license : skill.license;
    const compatibility = effectiveOverlay ? effectiveOverlay.compatibility : skill.compatibility;
    const version = effectiveOverlay?.version ?? skill.latestVersion;
    const isDeprecated = effectiveOverlay?.isDeprecated === true;
    const deprecationNote = effectiveOverlay?.deprecationNote ?? null;

    let presignedPackageUrl = "";
    if (storageKey) {
      try {
        const result = await this.storageClient.getPresignedUrl(this.storageBucket, storageKey);
        presignedPackageUrl = result.presignedUrl;
      } catch (err) {
        logger.warn({ guid: skill.guid, version, err }, "Presigned URL generation failed");
      }
    }

    const tags: string[] = metadata?.tags ?? [];

    return {
      guid: skill.guid,
      name: skill.name,
      description: skill.description,
      license,
      compatibility,
      metadata: metadata as unknown as Record<string, unknown>,
      tags,
      skillHash,
      presignedPackageUrl,
      isPrivate: skill.isPrivate,
      ownerId: skill.ownerId,
      createdBy: skill.createdBy,
      createdByEmail: skill.createdByEmail,
      createdByDisplayName: skill.createdByDisplayName,
      createdOn: skill.createdOn instanceof Date ? skill.createdOn.toISOString() : String(skill.createdOn),
      updatedOn: skill.updatedOn instanceof Date ? skill.updatedOn.toISOString() : String(skill.updatedOn),
      sharedWithUsers: skill.sharedWithUsers,
      sharedWithOrgs: skill.sharedWithOrgs,
      version,
      isDeprecated,
      deprecationNote,
      source: skill.source
        ? {
            type: "github",
            repo: skill.source.repo,
            ref: skill.source.ref,
            path: skill.source.path,
            lastSyncedAt:
              skill.source.lastSyncedAt instanceof Date
                ? skill.source.lastSyncedAt.toISOString()
                : String(skill.source.lastSyncedAt),
            lastSyncedCommit: skill.source.lastSyncedCommit,
          }
        : undefined,
      nyxidServiceId: skill.nyxidServiceId ?? null,
      nyxidServiceSlug: skill.nyxidServiceSlug ?? null,
      nyxidServiceLabel: skill.nyxidServiceLabel ?? null,
      isSystemSkill: skill.isSystemSkill === true,
    };
  }

  /**
   * Validate ZIP format rules (structure, required files, frontmatter, etc.).
   *
   * Returns the list of rule violations. An empty array means the package is valid.
   * Public so the `/skill-format/validate` route can call it without an `as any` cast.
   */
  async validateZipFormat(zipBuffer: Uint8Array): Promise<Array<{ rule: string; message: string }>> {
    const violations: Array<{ rule: string; message: string }> = [];

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch {
      violations.push({ rule: "valid-zip", message: "The uploaded file is not a valid ZIP archive." });
      return violations;
    }

    const allPaths = Object.keys(zip.files);
    const { rootFolderName, rootEntries, getFile } = resolveZipRoot(zip, allPaths);

    const KEBAB_RE = /^[a-z0-9][a-z0-9-]*$/;
    const ALLOWED_ROOT = new Set(["SKILL.md", "scripts", "references", "assets"]);

    if (rootFolderName && !KEBAB_RE.test(rootFolderName)) {
      violations.push({
        rule: "folder-name-kebab-case",
        message: `Package folder name "${rootFolderName}" must be kebab-case.`,
      });
    }

    const skillMdEntry = getFile("SKILL.md");
    if (!skillMdEntry) {
      const caseMatch = rootEntries.find((e) => e.toLowerCase() === "skill.md");
      violations.push({
        rule: caseMatch ? "skill-md-exact-case" : "skill-md-exists",
        message: caseMatch
          ? `Found "${caseMatch}" but the file must be exactly "SKILL.md".`
          : "SKILL.md must be present at the root of the skill package.",
      });
      return violations;
    }

    if (getFile("README.md")) {
      violations.push({
        rule: "no-readme-md",
        message: "README.md is not allowed at the root.",
      });
    }

    for (const entry of rootEntries) {
      const name = entry.replace(/\/$/, "");
      if (!ALLOWED_ROOT.has(name)) {
        violations.push({
          rule: "allowed-root-items",
          message: `Root item "${name}" is not allowed. Only SKILL.md, scripts/, references/, assets/ permitted.`,
        });
      }
    }

    let skillMdContent: string;
    try {
      skillMdContent = await skillMdEntry.async("string");
    } catch {
      violations.push({ rule: "skill-md-readable", message: "Could not read SKILL.md content." });
      return violations;
    }

    const fmMatch = skillMdContent.match(FRONTMATTER_REGEX);
    if (!fmMatch) {
      violations.push({
        rule: "frontmatter-present",
        message: "SKILL.md must have a frontmatter section delimited by ---.",
      });
      return violations;
    }

    const yamlBlock = fmMatch[1];
    if (yamlBlock.includes("<") || yamlBlock.includes(">")) {
      violations.push({
        rule: "no-xml-brackets",
        message: "Frontmatter must not contain XML angle brackets (< or >).",
      });
    }

    let frontmatter: Record<string, unknown>;
    try {
      const parsed = parseYaml(yamlBlock);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        violations.push({ rule: "frontmatter-valid-yaml", message: "Frontmatter must be a valid YAML object." });
        return violations;
      }
      frontmatter = parsed as Record<string, unknown>;
    } catch (e) {
      violations.push({
        rule: "frontmatter-valid-yaml",
        message: `Frontmatter YAML is invalid: ${e instanceof Error ? e.message : String(e)}`,
      });
      return violations;
    }

    // Validate via Zod schema
    const result = validateSkillFrontmatter(frontmatter);
    if (!result.success) {
      for (const err of result.errors) {
        violations.push({ rule: `frontmatter.${err.field}`, message: err.message });
      }
    } else {
      // Cross-check name matches folder
      if (rootFolderName && result.data.name !== rootFolderName) {
        violations.push({
          rule: "name-matches-folder",
          message: `Skill name "${result.data.name}" must match folder name "${rootFolderName}".`,
        });
      }

      // Name must not contain forbidden terms
      const nameLower = result.data.name.toLowerCase();
      if (nameLower.includes("claude") || nameLower.includes("anthropic")) {
        violations.push({
          rule: "name-no-forbidden-terms",
          message: `Skill name must not contain "claude" or "anthropic".`,
        });
      }

      // Description must not contain XML brackets
      if (result.data.description.includes("<") || result.data.description.includes(">")) {
        violations.push({
          rule: "description-no-xml",
          message: "Description must not contain XML angle brackets.",
        });
      }
    }

    return violations;
  }
}
