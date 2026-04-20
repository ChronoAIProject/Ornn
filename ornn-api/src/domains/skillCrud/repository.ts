/**
 * Skill CRUD repository. Uses storageKey instead of s3Url.
 * @module domains/skillCrud/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { SkillDocument, SkillMetadata } from "../../shared/types/index";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillCrudRepository" });

export interface CreateSkillData {
  guid: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata: SkillMetadata;
  skillHash: string;
  storageKey: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  isPrivate?: boolean;
  isSystem?: boolean;
  nyxidServiceId?: string;
  /** Initial version, e.g. "1.0". Required. */
  latestVersion: string;
}

export interface UpdateSkillData {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: SkillMetadata;
  skillHash?: string;
  storageKey?: string;
  isPrivate?: boolean;
  /** Cached latest-version pointer; update when a new package version is published. */
  latestVersion?: string;
  updatedBy: string;
}

export interface SkillFilters {
  q?: string;
  scope?: "public" | "private" | "mixed";
  currentUserId?: string;
  page: number;
  pageSize: number;
}

export class SkillRepository {
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
      storageKey: data.storageKey,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn: now,
      updatedBy: data.createdBy,
      updatedOn: now,
      isPrivate: data.isPrivate ?? true,
      isSystem: data.isSystem ?? false,
      nyxidServiceId: data.nyxidServiceId ?? null,
      latestVersion: data.latestVersion,
    };

    try {
      await this.collection.insertOne(doc);
      logger.info({ guid: data.guid, name: data.name }, "Skill created");
    } catch (err: any) {
      if (err?.code === 11000) {
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
    if (data.storageKey !== undefined) setFields.storageKey = data.storageKey;
    if (data.isPrivate !== undefined) setFields.isPrivate = data.isPrivate;
    if (data.latestVersion !== undefined) setFields.latestVersion = data.latestVersion;

    await this.collection.updateOne({ _id: guid as any }, { $set: setFields });
    logger.info({ guid }, "Skill updated");
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: guid as any });
    logger.info({ guid }, "Skill hard-deleted");
  }

  async keywordSearch(
    query: string,
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
    /** Optional additional filter — restrict results to this set of GUIDs. */
    restrictToGuids?: string[],
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId);

    matchStage.$or = [
      { _id: query },
      { name: { $regex: escapeRegex(query), $options: "i" } },
      { description: { $regex: escapeRegex(query), $options: "i" } },
    ];

    if (restrictToGuids) {
      if (restrictToGuids.length === 0) return { skills: [], total: 0 };
      matchStage._id = { $in: restrictToGuids };
    }

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection.find(matchStage).sort({ createdOn: -1 }).skip(offset).limit(pageSize).toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  async findByScope(
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
    /** Optional additional filter — restrict results to this set of GUIDs. */
    restrictToGuids?: string[],
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId);

    if (restrictToGuids) {
      if (restrictToGuids.length === 0) return { skills: [], total: 0 };
      matchStage._id = { $in: restrictToGuids };
    }

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection.find(matchStage).sort({ createdOn: -1 }).skip(offset).limit(pageSize).toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  /**
   * Load ALL skills matching scope (no pagination). Used by LLM semantic search.
   * Projects fields needed for semantic evaluation: name, description, metadata, license, compatibility, etc.
   */
  async findAllByScope(
    scope: "public" | "private" | "mixed",
    currentUserId: string,
  ): Promise<SkillDocument[]> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId);

    const docs = await this.collection
      .find(matchStage)
      .project({ _id: 1, name: 1, description: 1, metadata: 1, isPrivate: 1, createdBy: 1, createdByEmail: 1, createdByDisplayName: 1, createdOn: 1, updatedOn: 1, storageKey: 1, skillHash: 1, license: 1, compatibility: 1, updatedBy: 1 })
      .sort({ createdOn: -1 })
      .toArray();

    return docs.map((d) => mapDoc(d)!);
  }

  async findByGuids(guids: string[]): Promise<SkillDocument[]> {
    if (guids.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: guids } as any }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async findByNyxidServiceId(nyxidServiceId: string): Promise<SkillDocument | null> {
    const doc = await this.collection.findOne({ nyxidServiceId, isSystem: true });
    return mapDoc(doc);
  }

  async findSystemSkills(): Promise<SkillDocument[]> {
    const docs = await this.collection.find({ isSystem: true }).sort({ createdOn: -1 }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  async searchSystemSkills(
    query: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = { isSystem: true };
    if (query && query.length > 0) {
      matchStage.$or = [
        { _id: query },
        { name: { $regex: escapeRegex(query), $options: "i" } },
        { description: { $regex: escapeRegex(query), $options: "i" } },
      ];
    }

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
}

function applyScope(matchStage: Record<string, unknown>, scope: "public" | "private" | "mixed", currentUserId: string): void {
  if (scope === "public") {
    matchStage.isPrivate = false;
  } else if (scope === "private") {
    matchStage.createdBy = currentUserId;
  } else if (scope === "mixed") {
    matchStage.$or = [{ isPrivate: false }, { createdBy: currentUserId }];
  }
}

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
    storageKey: doc.storageKey ?? doc.s3Url ?? "",
    createdBy: doc.createdBy ?? "",
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
    updatedBy: doc.updatedBy ?? "",
    updatedOn: doc.updatedOn ?? new Date(),
    isPrivate: doc.isPrivate ?? true,
    isSystem: doc.isSystem ?? false,
    nyxidServiceId: doc.nyxidServiceId ?? undefined,
    latestVersion: doc.latestVersion ?? "0.1",
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
