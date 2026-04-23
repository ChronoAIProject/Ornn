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
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillVersionRepository" });

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
        "SKILL_VERSION_NOT_FOUND",
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
  };
}
