/**
 * MongoDB-backed skill repository implementation.
 * Aligned with design spec schema: guid, name, description, license,
 * compatibility, metadata, skillHash, s3Url, createdBy, createdOn,
 * updatedBy, updatedOn, isPrivate.
 * @module repositories/skillRepository
 */

import type { Collection, Db, Document } from "mongodb";
import type {
  ISkillRepository,
  SkillDocument,
  SkillMetadata,
  CreateSkillData,
  UpdateSkillData,
  SkillFilters,
} from "./skillRepository.interface";
import { isDuplicateKeyError, AppError } from "../../../shared/types/index";

// Re-export interfaces
export type { ISkillRepository, SkillDocument, SkillMetadata, CreateSkillData, UpdateSkillData, SkillFilters };

export class SkillRepository implements ISkillRepository {
  private readonly collection: Collection;

  constructor(db: Db) {
    this.collection = db.collection("skills");
  }

  async findByGuid(guid: string): Promise<SkillDocument | null> {
    const doc = await this.collection.findOne({ _id: guid as any });
    return mapDoc(doc);
  }

  async findByName(name: string): Promise<SkillDocument | null> {
    const doc = await this.collection.findOne({ name });
    return mapDoc(doc);
  }

  async findAll(filters: SkillFilters): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, filters.scope ?? "private", filters.currentUserId ?? "");

    if (filters.q) {
      matchStage.$or = [
        { _id: filters.q },
        { name: { $regex: escapeRegex(filters.q), $options: "i" } },
        { description: { $regex: escapeRegex(filters.q), $options: "i" } },
      ];
    }

    const total = await this.collection.countDocuments(matchStage);
    const offset = (filters.page - 1) * filters.pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(filters.pageSize)
      .toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  async create(data: CreateSkillData): Promise<SkillDocument> {
    const now = new Date();
    const doc: Record<string, unknown> = {
      _id: data.guid as any,
      name: data.name,
      description: data.description,
      license: data.license ?? null,
      compatibility: data.compatibility ?? null,
      metadata: data.metadata,
      skillHash: data.skillHash,
      s3Url: data.s3Url,
      createdBy: data.createdBy,
      createdOn: now,
      updatedBy: data.createdBy,
      updatedOn: now,
      isPrivate: data.isPrivate ?? true,
    };

    try {
      await this.collection.insertOne(doc);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw AppError.conflict("SKILL_NAME_EXISTS", `Skill '${data.name}' already exists`);
      }
      throw err;
    }

    return mapDoc(doc)!;
  }

  async update(guid: string, data: UpdateSkillData): Promise<SkillDocument> {
    const setFields: Record<string, unknown> = {
      updatedBy: data.updatedBy,
      updatedOn: new Date(),
    };

    if (data.name !== undefined) setFields.name = data.name;
    if (data.description !== undefined) setFields.description = data.description;
    if (data.license !== undefined) setFields.license = data.license;
    if (data.compatibility !== undefined) setFields.compatibility = data.compatibility;
    if (data.metadata !== undefined) setFields.metadata = data.metadata;
    if (data.skillHash !== undefined) setFields.skillHash = data.skillHash;
    if (data.s3Url !== undefined) setFields.s3Url = data.s3Url;
    if (data.isPrivate !== undefined) setFields.isPrivate = data.isPrivate;

    await this.collection.updateOne({ _id: guid as any }, { $set: setFields });
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: guid as any });
  }

  async keywordSearch(
    query: string,
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId);

    matchStage.$or = [
      { _id: query },
      { name: { $regex: escapeRegex(query), $options: "i" } },
      { description: { $regex: escapeRegex(query), $options: "i" } },
    ];

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  async findByScope(
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId);

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  async findByGuids(guids: string[]): Promise<SkillDocument[]> {
    if (guids.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: guids } as any }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }
}

// ==========================================================================
// Helper functions
// ==========================================================================

/** Apply scope filter to a MongoDB match stage. */
function applyScope(
  matchStage: Record<string, unknown>,
  scope: "public" | "private" | "mixed",
  currentUserId: string,
): void {
  if (scope === "public") {
    matchStage.isPrivate = false;
  } else if (scope === "private") {
    matchStage.createdBy = currentUserId;
  } else if (scope === "mixed") {
    matchStage.$or = [
      { isPrivate: false },
      { createdBy: currentUserId },
    ];
  }
}

/** Map a MongoDB document to a SkillDocument. */
function mapDoc(doc: Document | null): SkillDocument | null {
  if (!doc) return null;
  return {
    guid: doc._id as string,
    name: doc.name,
    description: doc.description,
    license: doc.license ?? null,
    compatibility: doc.compatibility ?? null,
    metadata: doc.metadata ?? { category: "plain" },
    skillHash: doc.skillHash ?? "",
    s3Url: doc.s3Url ?? "",
    createdBy: doc.createdBy ?? "",
    createdOn: doc.createdOn ?? doc.created_at ?? new Date(),
    updatedBy: doc.updatedBy ?? "",
    updatedOn: doc.updatedOn ?? doc.updated_at ?? new Date(),
    isPrivate: doc.isPrivate ?? true,
  };
}

/** Escape special regex characters for safe use in RegExp constructor. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
