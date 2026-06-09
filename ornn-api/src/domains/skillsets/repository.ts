/**
 * Skillset identity repository — the `skillsets` collection (#969).
 *
 * Thin Mongo wrapper mirroring `SkillRepository` for the skillset
 * identity document. Keys each skillset by its UUID-string `_id` (the
 * public GUID), exactly like skills. Reuses the shared `scopeFilter.ts`
 * predicates so the skillset visibility matrix can never drift from the
 * skill one; adds a `kind` equality filter + `tags $all` for skillset
 * search.
 *
 * @module domains/skillsets/repository
 */

import type { Collection, Db, Document } from "mongodb";
import { AppError } from "../../shared/types/index";
import { createLogger } from "../../shared/logger";
import { applyScope, applyExtraFilters, type SkillScope } from "../skills/crud/scopeFilter";
import type { SkillsetDocument, SkillsetKind } from "./types";

const logger = createLogger("skillsetRepository");

/** Coerce a string GUID into the `_id` shape the driver expects. */
function skillsetId(guid: string): never {
  if (typeof guid !== "string" || guid.length === 0) {
    throw AppError.badRequest(
      "invalid_skillset_id",
      "Skillset id must be a non-empty string",
    );
  }
  return guid as never;
}

export interface CreateSkillsetData {
  guid: string;
  name: string;
  description: string;
  kind: SkillsetKind;
  tags: string[];
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  isPrivate?: boolean | undefined;
  /** Initial version, e.g. "1.0". Required. */
  latestVersion: string;
}

export interface UpdateSkillsetData {
  description?: string;
  kind?: SkillsetKind;
  tags?: string[];
  isPrivate?: boolean;
  sharedWithUsers?: string[];
  sharedWithOrgs?: string[];
  latestVersion?: string;
  updatedBy: string;
}

/** Filters specific to skillset search: `kind` equality + `tags $all`. */
export interface SkillsetSearchFilters {
  kind?: SkillsetKind | undefined;
  tagsAll?: string[] | undefined;
  sharedWithOrgsAny?: string[] | undefined;
  sharedWithUsersAny?: string[] | undefined;
  createdByAny?: string[] | undefined;
}

export class SkillsetRepository {
  private readonly collection: Collection;
  /** Server-side cap on paginated reads (mirrors SkillRepository). */
  private static readonly MAX_QUERY_MS = 5_000;

  constructor(db: Db) {
    this.collection = db.collection("skillsets");
  }

  /**
   * Ensure the indexes the skillset collection relies on. Idempotent.
   * `name` is unique (one skillset per name, like skills); the rest feed
   * scoped search + ordering.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ name: 1 }, { unique: true }),
      this.collection.createIndex({ createdBy: 1, createdOn: -1 }),
      this.collection.createIndex({ createdOn: -1 }),
      this.collection.createIndex({ isPrivate: 1, createdOn: -1 }),
      this.collection.createIndex({ kind: 1, createdOn: -1 }),
    ]);
  }

  async findByGuid(guid: string): Promise<SkillsetDocument | null> {
    const doc = await this.collection.findOne({ _id: skillsetId(guid) });
    return mapDoc(doc);
  }

  async findByName(name: string): Promise<SkillsetDocument | null> {
    const doc = await this.collection.findOne({ name });
    return mapDoc(doc);
  }

  async create(data: CreateSkillsetData): Promise<SkillsetDocument> {
    const now = new Date();
    const doc: Record<string, unknown> = {
      _id: skillsetId(data.guid),
      name: data.name,
      description: data.description,
      kind: data.kind,
      tags: data.tags,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn: now,
      updatedBy: data.createdBy,
      updatedOn: now,
      isPrivate: data.isPrivate ?? true,
      sharedWithUsers: [],
      sharedWithOrgs: [],
      latestVersion: data.latestVersion,
    };

    try {
      await this.collection.insertOne(doc as never);
      logger.info({ guid: data.guid, name: data.name, kind: data.kind }, "Skillset created");
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === 11000) {
        throw AppError.conflict("skillset_name_exists", `Skillset '${data.name}' already exists`);
      }
      throw err;
    }
    return mapDoc(doc as Document)!;
  }

  async update(guid: string, data: UpdateSkillsetData): Promise<SkillsetDocument> {
    const setFields: Record<string, unknown> = {
      updatedBy: data.updatedBy,
      updatedOn: new Date(),
    };
    if (data.description !== undefined) setFields.description = data.description;
    if (data.kind !== undefined) setFields.kind = data.kind;
    if (data.tags !== undefined) setFields.tags = data.tags;
    if (data.isPrivate !== undefined) setFields.isPrivate = data.isPrivate;
    if (data.sharedWithUsers !== undefined) setFields.sharedWithUsers = data.sharedWithUsers;
    if (data.sharedWithOrgs !== undefined) setFields.sharedWithOrgs = data.sharedWithOrgs;
    if (data.latestVersion !== undefined) setFields.latestVersion = data.latestVersion;

    await this.collection.updateOne({ _id: skillsetId(guid) }, { $set: setFields });
    logger.info({ guid }, "Skillset updated");
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: skillsetId(guid) });
    logger.info({ guid }, "Skillset hard-deleted");
  }

  /**
   * Scoped + filtered paginated read. Visibility via the shared
   * `applyScope` (identical to skills); `kind` equality + `tags $all` +
   * the shared registry-chip filters layered on. Mirrors
   * `SkillRepository.findByScope`.
   */
  async findByScope(
    scope: SkillScope,
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
    filters?: SkillsetSearchFilters,
  ): Promise<{ skillsets: SkillsetDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);
    // Scope resolved to "match nothing" — short-circuit.
    if ((matchStage._id as { $in?: unknown[] } | undefined)?.$in?.length === 0) {
      return { skillsets: [], total: 0 };
    }

    // Reuse the shared chip filters (`tags $all`, shared-with-*Any,
    // createdByAny) verbatim; `tags` on a skillset lives at the top level
    // (not under `metadata.tags`), so add the `tags $all` clause directly
    // rather than via `applyExtraFilters`' `metadata.tags` path.
    applyExtraFilters(matchStage, {
      sharedWithOrgsAny: filters?.sharedWithOrgsAny,
      sharedWithUsersAny: filters?.sharedWithUsersAny,
      createdByAny: filters?.createdByAny,
    });

    const extra: Array<Record<string, unknown>> = [];
    if (filters?.kind) extra.push({ kind: filters.kind });
    if (filters?.tagsAll && filters.tagsAll.length > 0) {
      extra.push({ tags: { $all: filters.tagsAll } });
    }
    if (extra.length > 0) {
      const existingAnd = (matchStage.$and as Array<Record<string, unknown>> | undefined) ?? [];
      matchStage.$and = [...existingAnd, ...extra];
    }

    const total = await this.collection.countDocuments(matchStage, {
      maxTimeMS: SkillsetRepository.MAX_QUERY_MS,
    });
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .maxTimeMS(SkillsetRepository.MAX_QUERY_MS)
      .toArray();

    return { skillsets: docs.map((d) => mapDoc(d)!), total };
  }
}

function mapDoc(doc: Document | null): SkillsetDocument | null {
  if (!doc) return null;
  return {
    guid: doc._id as string,
    name: doc.name,
    description: doc.description ?? "",
    kind: (doc.kind as SkillsetKind) ?? "generic",
    tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
    createdBy: doc.createdBy ?? "",
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
    updatedBy: doc.updatedBy ?? "",
    updatedOn: doc.updatedOn ?? new Date(),
    isPrivate: doc.isPrivate ?? true,
    sharedWithUsers: Array.isArray(doc.sharedWithUsers) ? (doc.sharedWithUsers as string[]) : [],
    sharedWithOrgs: Array.isArray(doc.sharedWithOrgs) ? (doc.sharedWithOrgs as string[]) : [],
    latestVersion: doc.latestVersion ?? "1.0",
  };
}
