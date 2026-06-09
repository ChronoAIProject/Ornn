/**
 * Repository for the `skillset_versions` Mongo collection (#969).
 *
 * Each document is an immutable, append-only snapshot of a skillset at a
 * specific version. `_id = ${skillsetGuid}@${version}` gives free
 * uniqueness on (skillsetGuid, version) without a separate compound
 * unique index — identical to `skillVersionRepository`.
 *
 * Carries NO blob / skillHash / storageKey / AgentSeal — a skillset
 * version is pure metadata (a member-ref list). The heavy artefacts live
 * on the member skill versions, resolved at closure time.
 *
 * @module domains/skillsets/skillsetVersionRepository
 */

import type { Collection, Db, Document } from "mongodb";
import { AppError } from "../../shared/types/index";
import { createLogger } from "../../shared/logger";
import type { SkillsetVersionDocument, SkillsetKind } from "./types";

const logger = createLogger("skillsetVersionRepository");

export interface CreateSkillsetVersionData {
  skillsetGuid: string;
  version: string;
  majorVersion: number;
  minorVersion: number;
  kind: SkillsetKind;
  description: string;
  /** Master prompt (#978) — per-version, immutable. */
  instructions: string;
  tags: string[];
  members: string[];
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn?: Date | undefined;
}

export class SkillsetVersionRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("skillset_versions");
  }

  /** Idempotent — call once on startup. */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { skillsetGuid: 1, majorVersion: -1, minorVersion: -1 },
      { name: "skillset_versions_latest_lookup" },
    );
  }

  async create(data: CreateSkillsetVersionData): Promise<SkillsetVersionDocument> {
    const createdOn = data.createdOn ?? new Date();
    const doc: Document = {
      _id: `${data.skillsetGuid}@${data.version}` as unknown as Document["_id"],
      skillsetGuid: data.skillsetGuid,
      version: data.version,
      majorVersion: data.majorVersion,
      minorVersion: data.minorVersion,
      kind: data.kind,
      description: data.description,
      instructions: data.instructions,
      tags: data.tags,
      members: data.members,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn,
    };

    try {
      await this.collection.insertOne(doc as never);
      logger.info(
        { skillsetGuid: data.skillsetGuid, version: data.version, memberCount: data.members.length },
        "Skillset version inserted",
      );
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw AppError.conflict(
          "skillset_version_exists",
          `Version '${data.version}' already exists for skillset '${data.skillsetGuid}'`,
        );
      }
      throw err;
    }
    return mapDoc(doc)!;
  }

  async findBySkillsetAndVersion(
    skillsetGuid: string,
    version: string,
  ): Promise<SkillsetVersionDocument | null> {
    const doc = await this.collection.findOne({ _id: `${skillsetGuid}@${version}` as never });
    return mapDoc(doc);
  }

  async findLatestBySkillset(skillsetGuid: string): Promise<SkillsetVersionDocument | null> {
    const doc = await this.collection
      .find({ skillsetGuid })
      .sort({ majorVersion: -1, minorVersion: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }

  async listBySkillset(skillsetGuid: string): Promise<SkillsetVersionDocument[]> {
    const docs = await this.collection
      .find({ skillsetGuid })
      .sort({ majorVersion: -1, minorVersion: -1 })
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async deleteAllBySkillset(skillsetGuid: string): Promise<number> {
    const result = await this.collection.deleteMany({ skillsetGuid });
    logger.info(
      { skillsetGuid, deleted: result.deletedCount },
      "Skillset versions cascade-deleted",
    );
    return result.deletedCount ?? 0;
  }
}

function mapDoc(doc: Document | null): SkillsetVersionDocument | null {
  if (!doc) return null;
  return {
    _id: doc._id as string,
    skillsetGuid: doc.skillsetGuid,
    version: doc.version,
    majorVersion: doc.majorVersion,
    minorVersion: doc.minorVersion,
    kind: (doc.kind as SkillsetKind) ?? "generic",
    description: doc.description ?? "",
    // `?? ""` tolerates a pre-#978 version row that predates the required
    // master prompt — the surface stays well-typed (never `undefined`).
    instructions: doc.instructions ?? "",
    tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
    members: Array.isArray(doc.members) ? (doc.members as string[]) : [],
    createdBy: doc.createdBy,
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
  };
}
