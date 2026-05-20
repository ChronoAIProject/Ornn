/**
 * Repository for the `skill_versions` Mongo collection.
 * Each document is an immutable snapshot of a skill at a specific version.
 *
 * `_id` is `${skillGuid}@${version}` which gives us free uniqueness on
 * (skillGuid, version) without a separate compound unique index.
 *
 * @module domains/skills/crud/skillVersionRepository
 */

import type { Collection, Db, Document } from "mongodb";
import type { SkillVersionDocument, SkillMetadata } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";
const logger = createLogger("skillVersionRepository");

export interface CreateSkillVersionData {
  skillGuid: string;
  version: string;
  majorVersion: number;
  minorVersion: number;
  storageKey: string;
  skillHash: string;
  metadata: SkillMetadata;
  license?: string | null;
  compatibility?: string | null;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn?: Date;
  /** Author-supplied release notes pulled from SKILL.md frontmatter. */
  releaseNotes?: string | null;
}

/**
 * Persisted shape for AgentSeal results (#253). Lives on the version
 * document so a skill's per-version trust score can be surfaced on the
 * detail page without a separate collection.
 *
 * The `findings` shape is intentionally permissive — the AgentSeal CLI
 * is the source of truth for finding structure, and it evolves between
 * pinned versions. We carry whatever it emits, raw, so the UI can render
 * future fields without a schema migration.
 */
export interface AgentsealScanRecord {
  /** 0–100 scan-time trust score. */
  score: number;
  /** Findings array from the per-file SkillScanner sweep. */
  findings: ReadonlyArray<Record<string, unknown>>;
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  /** Pinned `agentseal` package version that produced this scan. */
  agentsealVersion: string;
  /** Count of files actually walked (text-like, under size cap). */
  scannedFiles?: number;
}

export class SkillVersionRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("skill_versions");
  }

  /**
   * Idempotent: should be called once on startup. Creates the compound
   * index used for latest-version lookup; safe to call repeatedly.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { skillGuid: 1, majorVersion: -1, minorVersion: -1 },
      { name: "skill_versions_latest_lookup" },
    );
    // AgentSeal admin queries — "show me everything below 70". Sparse so
    // the index doesn't bloat with versions that haven't been scanned
    // yet (legacy rows from before #253, or rows where the scan failed).
    await this.collection.createIndex(
      { "agentsealScan.score": 1 },
      { name: "skill_versions_agentseal_score", sparse: true },
    );
  }

  async create(data: CreateSkillVersionData): Promise<SkillVersionDocument> {
    const createdOn = data.createdOn ?? new Date();
    const doc: Document = {
      _id: `${data.skillGuid}@${data.version}` as unknown as Document["_id"],
      skillGuid: data.skillGuid,
      version: data.version,
      majorVersion: data.majorVersion,
      minorVersion: data.minorVersion,
      storageKey: data.storageKey,
      skillHash: data.skillHash,
      metadata: data.metadata,
      license: data.license ?? null,
      compatibility: data.compatibility ?? null,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn,
      releaseNotes: data.releaseNotes ?? null,
    };

    try {
      await this.collection.insertOne(doc as never);
      logger.info({ skillGuid: data.skillGuid, version: data.version }, "Skill version inserted");
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw AppError.conflict(
          "SKILL_VERSION_EXISTS",
          `Version '${data.version}' already exists for skill '${data.skillGuid}'`,
        );
      }
      throw err;
    }

    return mapDoc(doc)!;
  }

  async findBySkillAndVersion(skillGuid: string, version: string): Promise<SkillVersionDocument | null> {
    const doc = await this.collection.findOne({ _id: `${skillGuid}@${version}` as never });
    return mapDoc(doc);
  }

  async findLatestBySkill(skillGuid: string): Promise<SkillVersionDocument | null> {
    const doc = await this.collection
      .find({ skillGuid })
      .sort({ majorVersion: -1, minorVersion: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }

  async listBySkill(skillGuid: string): Promise<SkillVersionDocument[]> {
    const docs = await this.collection
      .find({ skillGuid })
      .sort({ majorVersion: -1, minorVersion: -1 })
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async deleteAllBySkill(skillGuid: string): Promise<number> {
    const result = await this.collection.deleteMany({ skillGuid });
    logger.info({ skillGuid, deleted: result.deletedCount }, "Skill versions cascade-deleted");
    return result.deletedCount ?? 0;
  }

  /** Delete one version row. Returns true when the row existed. */
  async deleteOne(skillGuid: string, version: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: `${skillGuid}@${version}` as never,
    });
    const deleted = (result.deletedCount ?? 0) > 0;
    if (deleted) {
      logger.info({ skillGuid, version }, "Skill version deleted");
    }
    return deleted;
  }

  /**
   * Persist (or refresh) the AgentSeal trust-score record for a single
   * version. v1 is warn-only — the publish path calls this fire-and-forget
   * so any failure is logged upstream and does not block the publish.
   *
   * Returns the updated document or null when the version doesn't exist
   * (ignored by the caller; we don't 404 because publish-path callers hold
   * the version they just wrote).
   */
  async setAgentsealScan(
    skillGuid: string,
    version: string,
    scan: AgentsealScanRecord,
  ): Promise<SkillVersionDocument | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: `${skillGuid}@${version}` as never },
      { $set: { agentsealScan: scan } },
      { returnDocument: "after" },
    );
    const updated = mapDoc(result);
    if (!updated) {
      logger.warn(
        { skillGuid, version },
        "AgentSeal scan persist: version row not found (skipping)",
      );
      return null;
    }
    logger.info(
      {
        skillGuid,
        version,
        score: scan.score,
        findings: scan.findings.length,
        agentsealVersion: scan.agentsealVersion,
      },
      "AgentSeal scan persisted on skill version",
    );
    return updated;
  }

  /**
   * Toggle the deprecation flag on a single version. When `isDeprecated` is
   * false the `deprecationNote` is cleared (empty note is never sticky).
   * 404s via AppError if the version row does not exist.
   */
  async setDeprecation(
    skillGuid: string,
    version: string,
    isDeprecated: boolean,
    deprecationNote?: string | null,
  ): Promise<SkillVersionDocument> {
    const setFields: Record<string, unknown> = { isDeprecated };
    if (isDeprecated) {
      // Keep explicit `null` when the caller wants to drop an old note while
      // still marking deprecated.
      setFields.deprecationNote = deprecationNote ?? null;
    } else {
      setFields.deprecationNote = null;
    }

    const result = await this.collection.findOneAndUpdate(
      { _id: `${skillGuid}@${version}` as never },
      { $set: setFields },
      { returnDocument: "after" },
    );
    const updated = mapDoc(result);
    if (!updated) {
      throw AppError.notFound(
        "skill_version_not_found",
        `Version '${version}' not found for skill '${skillGuid}'`,
      );
    }
    logger.info({ skillGuid, version, isDeprecated }, "Skill version deprecation updated");
    return updated;
  }
}

function mapDoc(doc: Document | null): SkillVersionDocument | null {
  if (!doc) return null;
  return {
    _id: doc._id as string,
    skillGuid: doc.skillGuid,
    version: doc.version,
    majorVersion: doc.majorVersion,
    minorVersion: doc.minorVersion,
    storageKey: doc.storageKey,
    skillHash: doc.skillHash,
    metadata: doc.metadata,
    license: doc.license ?? null,
    compatibility: doc.compatibility ?? null,
    createdBy: doc.createdBy,
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
    isDeprecated: doc.isDeprecated === true,
    deprecationNote: doc.deprecationNote ?? null,
    releaseNotes: typeof doc.releaseNotes === "string" ? doc.releaseNotes : null,
    agentsealScan: mapScan(doc.agentsealScan),
  };
}

function mapScan(raw: unknown): AgentsealScanRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = typeof r.score === "number" ? r.score : null;
  const findings = Array.isArray(r.findings) ? r.findings : null;
  const scannedAt = typeof r.scannedAt === "string" ? r.scannedAt : null;
  const agentsealVersion = typeof r.agentsealVersion === "string" ? r.agentsealVersion : null;
  if (score === null || findings === null || scannedAt === null || agentsealVersion === null) {
    return null;
  }
  const scannedFiles =
    typeof r.scannedFiles === "number" && Number.isFinite(r.scannedFiles)
      ? Math.max(0, Math.round(r.scannedFiles))
      : undefined;
  return {
    score,
    findings: findings as ReadonlyArray<Record<string, unknown>>,
    scannedAt,
    agentsealVersion,
    ...(scannedFiles !== undefined ? { scannedFiles } : {}),
  };
}
