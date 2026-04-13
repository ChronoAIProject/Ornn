/**
 * Skill CRUD service. Uses chrono-storage via StorageClient (bucket-based API).
 * Replaces direct S3 access. Uses storageKey instead of s3Url.
 * @module domains/skillCrud/service
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { SkillRepository } from "./repository";
import type { IStorageClient } from "../../clients/storageClient";
import type { SkillDocument, SkillMetadata, SkillDetailResponse } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import { validateSkillFrontmatter } from "../../shared/schemas/skillFrontmatter";
import { resolveZipRoot } from "../../shared/utils/zip";
import { parse as parseYaml } from "yaml";
import JSZip from "jszip";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillCrudService" });

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;

export interface SkillServiceDeps {
  skillRepo: SkillRepository;
  storageClient: IStorageClient;
  storageBucket: string;
}

export class SkillService {
  private readonly skillRepo: SkillRepository;
  private readonly storageClient: IStorageClient;
  private readonly storageBucket: string;

  constructor(deps: SkillServiceDeps) {
    this.skillRepo = deps.skillRepo;
    this.storageClient = deps.storageClient;
    this.storageBucket = deps.storageBucket;
  }

  async createSkill(
    zipBuffer: Uint8Array,
    userId: string,
    options?: { skipValidation?: boolean; userEmail?: string; userDisplayName?: string },
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
    const { name, description, license, compatibility, metadata } = await this.extractSkillInfo(zipBuffer);

    // 3. Check name uniqueness
    const existing = await this.skillRepo.findByName(name);
    if (existing) {
      throw AppError.conflict("SKILL_NAME_EXISTS", `Skill '${name}' already exists`);
    }

    // 4. Generate GUID and hash
    const guid = randomUUID();
    const skillHash = createHash("sha256").update(zipBuffer).digest("hex");

    // 5. Upload ZIP to chrono-storage
    const storageKey = `skills/${guid}.zip`;
    await this.storageClient.upload(this.storageBucket, storageKey, zipBuffer, "application/zip");
    logger.info({ guid, storageKey }, "Skill package uploaded to storage");

    // 6. Save to MongoDB
    await this.skillRepo.create({
      guid,
      name,
      description,
      license: license ?? undefined,
      compatibility: compatibility ?? undefined,
      metadata,
      skillHash,
      storageKey,
      createdBy: userId,
      createdByEmail: options?.userEmail,
      createdByDisplayName: options?.userDisplayName,
      isPrivate: true,
    });

    return { guid };
  }

  async getSkill(idOrName: string): Promise<SkillDetailResponse> {
    let skill = await this.skillRepo.findByGuid(idOrName);
    if (!skill) {
      skill = await this.skillRepo.findByName(idOrName);
    }
    if (!skill) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${idOrName}' not found`);
    }

    return this.buildDetailResponse(skill);
  }

  async updateSkill(
    guid: string,
    userId: string,
    options: { zipBuffer?: Uint8Array; isPrivate?: boolean; skipValidation?: boolean },
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

      const { name, description, license, compatibility, metadata } = await this.extractSkillInfo(options.zipBuffer);
      const skillHash = createHash("sha256").update(options.zipBuffer).digest("hex");

      // Upload new ZIP to chrono-storage (overwrite same key)
      const storageKey = `skills/${guid}.zip`;
      await this.storageClient.upload(this.storageBucket, storageKey, options.zipBuffer, "application/zip");
      logger.info({ guid, storageKey }, "Skill package updated in storage");

      Object.assign(updateData, {
        name,
        description,
        license,
        compatibility,
        metadata,
        skillHash,
        storageKey,
      });

    }

    if (options.isPrivate !== undefined) {
      updateData.isPrivate = options.isPrivate;
    }

    const updated = await this.skillRepo.update(guid, updateData as any);
    return this.buildDetailResponse(updated);
  }

  async deleteSkill(guid: string): Promise<void> {
    const existing = await this.skillRepo.findByGuid(guid);
    if (!existing) {
      throw AppError.notFound("SKILL_NOT_FOUND", `Skill '${guid}' not found`);
    }

    // Delete from chrono-storage
    const storageKey = `skills/${guid}.zip`;
    try {
      await this.storageClient.delete(this.storageBucket, storageKey);
      logger.info({ guid, storageKey }, "Skill package deleted from storage");
    } catch (err) {
      logger.warn({ guid, storageKey, err }, "Best-effort storage cleanup failed");
    }

    // Hard delete from MongoDB
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
    const { rootEntries } = resolveZipRoot(zip, allPaths);

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
      license: fm.license ?? null,
      compatibility: fm.compatibility ?? null,
      metadata,
    };
  }

  private async buildDetailResponse(skill: SkillDocument): Promise<SkillDetailResponse> {
    let presignedPackageUrl = "";
    if (skill.storageKey) {
      try {
        const result = await this.storageClient.getPresignedUrl(
          this.storageBucket,
          skill.storageKey,
        );
        presignedPackageUrl = result.presignedUrl;
      } catch (err) {
        logger.warn({ guid: skill.guid, err }, "Presigned URL generation failed");
      }
    }

    const tags: string[] = skill.metadata?.tags ?? [];

    return {
      guid: skill.guid,
      name: skill.name,
      description: skill.description,
      license: skill.license,
      compatibility: skill.compatibility,
      metadata: skill.metadata as unknown as Record<string, unknown>,
      tags,
      skillHash: skill.skillHash,
      presignedPackageUrl,
      isPrivate: skill.isPrivate,
      createdBy: skill.createdBy,
      createdByEmail: skill.createdByEmail,
      createdByDisplayName: skill.createdByDisplayName,
      createdOn: skill.createdOn instanceof Date ? skill.createdOn.toISOString() : String(skill.createdOn),
      updatedOn: skill.updatedOn instanceof Date ? skill.updatedOn.toISOString() : String(skill.updatedOn),
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
