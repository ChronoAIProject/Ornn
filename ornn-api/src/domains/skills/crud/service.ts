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
import { fetchSkillFromGitHub, type GitHubPullInput } from "./utils/githubPull";
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
    const { name, description, version, license, compatibility, metadata } = await this.extractSkillInfo(zipBuffer);
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

      const { name, description, version, license, compatibility, metadata } = await this.extractSkillInfo(options.zipBuffer);
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
    from: { version: string; hash: string; createdOn: string; isDeprecated: boolean };
    to: { version: string; hash: string; createdOn: string; isDeprecated: boolean };
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
      },
      to: {
        version: toDoc.version,
        hash: toDoc.skillHash,
        createdOn:
          toDoc.createdOn instanceof Date
            ? toDoc.createdOn.toISOString()
            : String(toDoc.createdOn),
        isDeprecated: toDoc.isDeprecated === true,
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

    return {
      name: fm.name,
      description: fm.description,
      version: fm.version,
      license: fm.license ?? null,
      compatibility: fm.compatibility ?? null,
      metadata,
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
    };
  }

  /** Validate ZIP format rules (structure, required files, etc.). */
  private async validateZipFormat(zipBuffer: Uint8Array): Promise<Array<{ rule: string; message: string }>> {
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
