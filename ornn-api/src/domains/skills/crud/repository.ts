/**
 * Skill CRUD repository. Uses storageKey instead of s3Url.
 * @module domains/skills/crud/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { SkillDocument, SkillMetadata } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";
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
  /**
   * Legacy back-compat field. New skills copy `createdBy` here; visibility
   * logic no longer consults it. Defaults to `createdBy` when omitted.
   */
  ownerId?: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  isPrivate?: boolean;
  /** Initial version, e.g. "1.0". Required. */
  latestVersion: string;
  /** Origin metadata when the skill was created via a pull from an external source. */
  source?: import("../../../shared/types/index").SkillSource;
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
  /**
   * Full replacement of the explicit per-user grant list. When undefined the
   * existing value on the doc is preserved.
   */
  sharedWithUsers?: string[];
  /** Full replacement of the explicit per-org grant list. */
  sharedWithOrgs?: string[];
  /** Cached latest-version pointer; update when a new package version is published. */
  latestVersion?: string;
  /** Origin metadata; bumped by the refresh-from-source path. */
  source?: import("../../../shared/types/index").SkillSource;
  updatedBy: string;
}

export interface SkillFilters {
  q?: string;
  scope?: "public" | "private" | "mixed";
  currentUserId?: string;
  page: number;
  pageSize: number;
}

/**
 * Additional registry-filter constraints passed by the search route
 * when the UI chips are active. `sharedWithOrgsAny` requires
 * `skill.sharedWithOrgs` to intersect the list; `sharedWithUsersAny`
 * is the analog for direct per-user grants; `createdByAny` narrows
 * the skill's author (used by the Shared-with-me tab's "from which
 * user" chip row).
 */
export interface ExtraFilters {
  sharedWithOrgsAny?: string[];
  sharedWithUsersAny?: string[];
  createdByAny?: string[];
  /**
   * Tri-state system-skill filter applied at the DB match level.
   * `"only"`    → `isSystemSkill: true`.
   * `"exclude"` → `isSystemSkill !== true` (covers absent / false / null).
   * `"any"` / undefined → no constraint.
   */
  systemFilter?: "any" | "only" | "exclude";
  /** Restrict to skills tied to this exact NyxID service id. */
  nyxidServiceId?: string;
  /** Skills must have ALL listed tags (AND match against `metadata.tags`). */
  tagsAll?: string[];
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
      ownerId: data.ownerId ?? data.createdBy,
      createdBy: data.createdBy,
      createdByEmail: data.createdByEmail ?? null,
      createdByDisplayName: data.createdByDisplayName ?? null,
      createdOn: now,
      updatedBy: data.createdBy,
      updatedOn: now,
      isPrivate: data.isPrivate ?? true,
      // Explicit ACLs start empty — author + platform admin always have
      // access; the shared-with lists are an additive allow-list.
      sharedWithUsers: [],
      sharedWithOrgs: [],
      latestVersion: data.latestVersion,
    };

    if (data.source) {
      doc.source = data.source;
    }

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
    if (data.sharedWithUsers !== undefined) setFields.sharedWithUsers = data.sharedWithUsers;
    if (data.sharedWithOrgs !== undefined) setFields.sharedWithOrgs = data.sharedWithOrgs;
    if (data.source !== undefined) setFields.source = data.source;
    if (data.latestVersion !== undefined) setFields.latestVersion = data.latestVersion;

    await this.collection.updateOne({ _id: guid as any }, { $set: setFields });
    logger.info({ guid }, "Skill updated");
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: guid as any });
    logger.info({ guid }, "Skill hard-deleted");
  }

  /**
   * Set or clear a NyxID-service tie. When `data.nyxidServiceId` is `null`
   * we wipe all four cached fields. Caller must have already validated
   * eligibility + decided whether to flip `isPrivate` (admin tie forces
   * public — passed via `data.isPrivate`).
   */
  async setNyxidService(
    guid: string,
    data: {
      nyxidServiceId: string | null;
      nyxidServiceSlug: string | null;
      nyxidServiceLabel: string | null;
      isSystemSkill: boolean;
      /** Optional override of the privacy flag — used when forcing public on admin ties. */
      isPrivate?: boolean;
      updatedBy: string;
    },
  ): Promise<SkillDocument> {
    const setFields: Record<string, unknown> = {
      nyxidServiceId: data.nyxidServiceId,
      nyxidServiceSlug: data.nyxidServiceSlug,
      nyxidServiceLabel: data.nyxidServiceLabel,
      isSystemSkill: data.isSystemSkill,
      updatedBy: data.updatedBy,
      updatedOn: new Date(),
    };
    if (data.isPrivate !== undefined) {
      setFields.isPrivate = data.isPrivate;
    }
    await this.collection.updateOne({ _id: guid as any }, { $set: setFields });
    logger.info(
      { guid, nyxidServiceId: data.nyxidServiceId, isSystemSkill: data.isSystemSkill },
      "Skill NyxID service tie updated",
    );
    return (await this.findByGuid(guid))!;
  }

  /**
   * List skills tied to a specific NyxID service id, scoped by visibility.
   * `scope=public` returns only public skills (the system-skill case);
   * `scope=mixed` lets the caller see private skills they have access to
   * (the personal-service case where the caller owns the service).
   */
  async findByNyxidService(
    serviceId: string,
    scope: "public" | "mixed",
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);
    applyExtraFilters(matchStage, { nyxidServiceId: serviceId });

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

  async keywordSearch(
    query: string,
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
    /** Optional additional filter — restrict results to this set of GUIDs. */
    restrictToGuids?: string[],
    extraFilters?: ExtraFilters,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);

    matchStage.$and = [
      ...(matchStage.$or ? [{ $or: matchStage.$or }] : []),
      {
        $or: [
          { _id: query },
          { name: { $regex: escapeRegex(query), $options: "i" } },
          { description: { $regex: escapeRegex(query), $options: "i" } },
        ],
      },
    ];
    delete matchStage.$or;

    if (restrictToGuids) {
      if (restrictToGuids.length === 0) return { skills: [], total: 0 };
      matchStage._id = { $in: restrictToGuids };
    }

    applyExtraFilters(matchStage, extraFilters);

    const total = await this.collection.countDocuments(matchStage);
    const offset = (page - 1) * pageSize;
    const docs = await this.collection.find(matchStage).sort({ createdOn: -1 }).skip(offset).limit(pageSize).toArray();

    return { skills: docs.map((d) => mapDoc(d)!), total };
  }

  async findByScope(
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
    /** Optional additional filter — restrict results to this set of GUIDs. */
    restrictToGuids?: string[],
    extraFilters?: ExtraFilters,
  ): Promise<{ skills: SkillDocument[]; total: number }> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);

    if (restrictToGuids) {
      if (restrictToGuids.length === 0) return { skills: [], total: 0 };
      matchStage._id = { $in: restrictToGuids };
    }

    applyExtraFilters(matchStage, extraFilters);

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
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
    currentUserId: string,
    userOrgIds: string[],
  ): Promise<SkillDocument[]> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);

    const docs = await this.collection
      .find(matchStage)
      .project({ _id: 1, name: 1, description: 1, metadata: 1, isPrivate: 1, ownerId: 1, sharedWithUsers: 1, sharedWithOrgs: 1, createdBy: 1, createdByEmail: 1, createdByDisplayName: 1, createdOn: 1, updatedOn: 1, storageKey: 1, skillHash: 1, license: 1, compatibility: 1, updatedBy: 1 })
      .sort({ createdOn: -1 })
      .toArray();

    return docs.map((d) => mapDoc(d)!);
  }

  async findByGuids(guids: string[]): Promise<SkillDocument[]> {
    if (guids.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: guids } as any }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Aggregate grants on skills owned by `userId` — which orgs and
   * users show up as grantees, with per-target skill counts. Used by
   * the registry My-Skills filter row.
   */
  async aggregateGrantsByOwner(userId: string): Promise<{
    orgs: Array<{ id: string; skillCount: number }>;
    users: Array<{ userId: string; skillCount: number }>;
  }> {
    if (!userId) return { orgs: [], users: [] };
    const docs = await this.collection
      .find({ createdBy: userId })
      .project({ sharedWithOrgs: 1, sharedWithUsers: 1 })
      .toArray();
    const orgCounts = new Map<string, number>();
    const userCounts = new Map<string, number>();
    for (const d of docs) {
      for (const id of (d.sharedWithOrgs as string[] | undefined) ?? []) {
        orgCounts.set(id, (orgCounts.get(id) ?? 0) + 1);
      }
      for (const id of (d.sharedWithUsers as string[] | undefined) ?? []) {
        userCounts.set(id, (userCounts.get(id) ?? 0) + 1);
      }
    }
    return {
      orgs: [...orgCounts].map(([id, skillCount]) => ({ id, skillCount })).sort((a, b) => b.skillCount - a.skillCount),
      users: [...userCounts].map(([userId, skillCount]) => ({ userId, skillCount })).sort((a, b) => b.skillCount - a.skillCount),
    };
  }

  /**
   * Aggregate sources on skills shared with `userId` (via caller's
   * orgs or direct per-user grants) — which orgs acted as the
   * visibility bridge and which authors shared. Used by the registry
   * Shared-with-me filter row. `userOrgIds` restricts org-based
   * matching to the caller's memberships (sharing into a foreign org
   * doesn't make it visible to the caller).
   */
  async aggregateSourcesForReader(
    userId: string,
    userOrgIds: string[],
  ): Promise<{
    orgs: Array<{ id: string; skillCount: number }>;
    users: Array<{ userId: string; skillCount: number }>;
  }> {
    if (!userId) return { orgs: [], users: [] };
    const orConditions: Array<Record<string, unknown>> = [{ sharedWithUsers: userId }];
    if (userOrgIds.length > 0) orConditions.push({ sharedWithOrgs: { $in: userOrgIds } });
    const docs = await this.collection
      .find({
        isPrivate: true,
        createdBy: { $ne: userId },
        $or: orConditions,
      })
      .project({ createdBy: 1, sharedWithOrgs: 1, sharedWithUsers: 1 })
      .toArray();
    const orgCounts = new Map<string, number>();
    const userCounts = new Map<string, number>();
    const orgSet = new Set(userOrgIds);
    for (const d of docs) {
      const grantOrgs = (d.sharedWithOrgs as string[] | undefined) ?? [];
      const grantUsers = (d.sharedWithUsers as string[] | undefined) ?? [];
      // Every caller-membership org that this skill was shared into
      // counts as a visibility bridge for this skill.
      for (const gid of grantOrgs) {
        if (orgSet.has(gid)) {
          orgCounts.set(gid, (orgCounts.get(gid) ?? 0) + 1);
        }
      }
      // Direct per-user grants imply the author shared explicitly with
      // the caller. Use `createdBy` — "who shared this with me?" —
      // since the owner is the only party that can mutate ACLs.
      if (grantUsers.includes(userId)) {
        const author = d.createdBy as string;
        if (author) userCounts.set(author, (userCounts.get(author) ?? 0) + 1);
      }
    }
    return {
      orgs: [...orgCounts].map(([id, skillCount]) => ({ id, skillCount })).sort((a, b) => b.skillCount - a.skillCount),
      users: [...userCounts].map(([userId, skillCount]) => ({ userId, skillCount })).sort((a, b) => b.skillCount - a.skillCount),
    };
  }

  /**
   * Find the (most recently created) skill whose metadata tags include
   * any of the given candidates. Used by the admin "generate system
   * skill" flow to find an existing skill already linked to a NyxID
   * service — the link is stored as a tag, not a dedicated field, so
   * detection is purely tag-based.
   */
  async findByAnyTag(tags: string[]): Promise<SkillDocument | null> {
    if (tags.length === 0) return null;
    const doc = await this.collection
      .find({ "metadata.tags": { $in: tags } })
      .sort({ createdOn: -1 })
      .limit(1)
      .next();
    return mapDoc(doc);
  }

  /**
   * Aggregate distinct tags across skills visible to the caller within
   * the given scope. Drives the per-tab tag-filter chip row. Sorted by
   * count desc so the most-used tags surface first.
   */
  async aggregateTagsByScope(
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine" | "system",
    currentUserId: string,
    userOrgIds: string[],
  ): Promise<Array<{ name: string; count: number }>> {
    const matchStage: Record<string, unknown> = {};
    if (scope === "system") {
      matchStage.isSystemSkill = true;
    } else {
      applyScope(matchStage, scope, currentUserId, userOrgIds);
    }
    const pipeline = [
      { $match: matchStage },
      { $unwind: "$metadata.tags" },
      { $group: { _id: "$metadata.tags", count: { $sum: 1 } } },
      { $sort: { count: -1 as const, _id: 1 as const } },
      { $limit: 200 },
    ];
    const docs = await this.collection.aggregate(pipeline).toArray();
    return docs.map((d) => ({ name: String(d._id ?? ""), count: d.count as number }));
  }

  /**
   * Aggregate distinct authors across skills visible to the caller
   * within the given scope. Returns per-author counts + cached email /
   * displayName for label rendering. Drives the public-tab author
   * filter chip row.
   */
  async aggregateAuthorsByScope(
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine" | "system",
    currentUserId: string,
    userOrgIds: string[],
  ): Promise<Array<{ userId: string; email: string; displayName: string; count: number }>> {
    const matchStage: Record<string, unknown> = {};
    if (scope === "system") {
      matchStage.isSystemSkill = true;
    } else {
      applyScope(matchStage, scope, currentUserId, userOrgIds);
    }
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$createdBy",
          count: { $sum: 1 },
          email: { $last: "$createdByEmail" },
          displayName: { $last: "$createdByDisplayName" },
        },
      },
      { $sort: { count: -1 as const, _id: 1 as const } },
      { $limit: 200 },
    ];
    const docs = await this.collection.aggregate(pipeline).toArray();
    return docs.map((d) => ({
      userId: String(d._id ?? ""),
      email: typeof d.email === "string" ? d.email : "",
      displayName: typeof d.displayName === "string" ? d.displayName : "",
      count: d.count as number,
    }));
  }

  /**
   * Aggregate the NyxID services that have at least one tied system
   * skill (`isSystemSkill: true`). Returns per-service counts + the
   * cached slug/label so the frontend can render filter chips without a
   * second NyxID round-trip.
   */
  async aggregateSystemServices(): Promise<
    Array<{ id: string; slug: string; label: string; count: number }>
  > {
    const pipeline = [
      { $match: { isSystemSkill: true, nyxidServiceId: { $ne: null } } },
      {
        $group: {
          _id: "$nyxidServiceId",
          count: { $sum: 1 },
          slug: { $last: "$nyxidServiceSlug" },
          label: { $last: "$nyxidServiceLabel" },
        },
      },
      { $sort: { count: -1 as const, _id: 1 as const } },
      { $limit: 100 },
    ];
    const docs = await this.collection.aggregate(pipeline).toArray();
    return docs.map((d) => ({
      id: String(d._id ?? ""),
      slug: typeof d.slug === "string" ? d.slug : "",
      label: typeof d.label === "string" ? d.label : (typeof d.slug === "string" ? d.slug : ""),
      count: d.count as number,
    }));
  }

  /**
   * Count visible skills by scope. Used by the registry tab-count
   * endpoint. Shares the same visibility rules as `findByScope`.
   */
  async countByScope(
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
    currentUserId: string,
    userOrgIds: string[],
  ): Promise<number> {
    const matchStage: Record<string, unknown> = {};
    applyScope(matchStage, scope, currentUserId, userOrgIds);
    // Scope resolved to "match nothing" — short-circuit.
    if ((matchStage._id as any)?.$in?.length === 0) return 0;
    return this.collection.countDocuments(matchStage);
  }
}

/**
 * Build the visibility match stage for a scoped query.
 *
 * Visibility model (matches `canReadSkill` in authorize.ts):
 *   - `public` scope  → `!isPrivate`.
 *   - `private` scope → every private skill the caller can see: author,
 *     any skill whose `sharedWithUsers` contains the caller's user_id, or
 *     any skill whose `sharedWithOrgs` overlaps the caller's org user_ids.
 *   - `mixed`   scope → union of the two above.
 *
 * Anonymous callers (empty `currentUserId` + empty `userOrgIds`) correctly
 * match nothing for the private branch.
 */
function applyScope(
  matchStage: Record<string, unknown>,
  scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
  currentUserId: string,
  userOrgIds: string[],
): void {
  if (scope === "mine") {
    // Skills authored by the caller, regardless of visibility. Strict
    // "skills I own", distinct from "private skills I can read" which
    // would also include skills shared with me.
    if (!currentUserId) {
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.createdBy = currentUserId;
    return;
  }
  const privateVisibility: Array<Record<string, unknown>> = [];
  if (currentUserId) {
    privateVisibility.push({ createdBy: currentUserId });
    privateVisibility.push({ sharedWithUsers: currentUserId });
  }
  if (userOrgIds.length > 0) {
    privateVisibility.push({ sharedWithOrgs: { $in: userOrgIds } });
  }

  if (scope === "public") {
    matchStage.isPrivate = false;
    return;
  }

  if (scope === "private") {
    if (privateVisibility.length === 0) {
      // Anonymous caller with no orgs — nothing to match.
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.isPrivate = true;
    matchStage.$or = privateVisibility;
    return;
  }

  if (scope === "shared-with-me") {
    // Private skills the caller can read but did NOT author.
    // By construction this excludes anonymous callers (no orgs, no user id).
    const grants: Array<Record<string, unknown>> = [];
    if (currentUserId) {
      grants.push({ sharedWithUsers: currentUserId });
    }
    if (userOrgIds.length > 0) {
      grants.push({ sharedWithOrgs: { $in: userOrgIds } });
    }
    if (grants.length === 0) {
      matchStage._id = { $in: [] };
      return;
    }
    matchStage.isPrivate = true;
    matchStage.$and = [
      { $or: grants },
      // `createdBy` excluded explicitly — a skill the caller authored is
      // never "shared with" them in the UI sense.
      ...(currentUserId ? [{ createdBy: { $ne: currentUserId } }] : []),
    ];
    return;
  }

  // mixed
  const clauses: Array<Record<string, unknown>> = [{ isPrivate: false }];
  if (privateVisibility.length > 0) {
    clauses.push({ isPrivate: true, $or: privateVisibility });
  }
  matchStage.$or = clauses;
}

/**
 * Merge the registry chip filters into an existing match stage.
 * Appended as additional clauses on `$and` so they compose cleanly
 * with whatever `applyScope` already set up.
 */
function applyExtraFilters(matchStage: Record<string, unknown>, filters: ExtraFilters | undefined): void {
  if (!filters) return;
  const extra: Array<Record<string, unknown>> = [];
  if (filters.sharedWithOrgsAny && filters.sharedWithOrgsAny.length > 0) {
    extra.push({ sharedWithOrgs: { $in: filters.sharedWithOrgsAny } });
  }
  if (filters.sharedWithUsersAny && filters.sharedWithUsersAny.length > 0) {
    extra.push({ sharedWithUsers: { $in: filters.sharedWithUsersAny } });
  }
  if (filters.createdByAny && filters.createdByAny.length > 0) {
    extra.push({ createdBy: { $in: filters.createdByAny } });
  }
  if (filters.systemFilter === "only") {
    extra.push({ isSystemSkill: true });
  } else if (filters.systemFilter === "exclude") {
    // Treat absent / null as "not a system skill" — that's how every
    // pre-feature skill in the registry looks.
    extra.push({ isSystemSkill: { $ne: true } });
  }
  if (filters.nyxidServiceId) {
    extra.push({ nyxidServiceId: filters.nyxidServiceId });
  }
  if (filters.tagsAll && filters.tagsAll.length > 0) {
    // AND-match: every requested tag must be in `metadata.tags`. Mongo's
    // `$all` is the right shape here.
    extra.push({ "metadata.tags": { $all: filters.tagsAll } });
  }
  if (extra.length === 0) return;
  const existingAnd = (matchStage.$and as Array<Record<string, unknown>> | undefined) ?? [];
  matchStage.$and = [...existingAnd, ...extra];
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
    // `ownerId` is a legacy field — new skills copy `createdBy` into it.
    // Fallback keeps pre-migration reads sane.
    ownerId: doc.ownerId ?? doc.createdBy ?? "",
    createdBy: doc.createdBy ?? "",
    createdByEmail: doc.createdByEmail ?? undefined,
    createdByDisplayName: doc.createdByDisplayName ?? undefined,
    createdOn: doc.createdOn ?? new Date(),
    updatedBy: doc.updatedBy ?? "",
    updatedOn: doc.updatedOn ?? new Date(),
    isPrivate: doc.isPrivate ?? true,
    // Shared-with lists default to empty when the field is absent — that's
    // how every skill predating the ACL feature looks. The migration script
    // explicitly writes [] so future reads don't need this fallback, but
    // we keep it here for safety against partial migrations.
    sharedWithUsers: Array.isArray(doc.sharedWithUsers) ? (doc.sharedWithUsers as string[]) : [],
    sharedWithOrgs: Array.isArray(doc.sharedWithOrgs) ? (doc.sharedWithOrgs as string[]) : [],
    latestVersion: doc.latestVersion ?? "0.1",
    source: doc.source
      ? {
          type: "github",
          repo: String(doc.source.repo ?? ""),
          ref: String(doc.source.ref ?? ""),
          path: String(doc.source.path ?? ""),
          lastSyncedAt: doc.source.lastSyncedAt instanceof Date ? doc.source.lastSyncedAt : new Date(doc.source.lastSyncedAt),
          lastSyncedCommit: String(doc.source.lastSyncedCommit ?? ""),
        }
      : undefined,
    nyxidServiceId: typeof doc.nyxidServiceId === "string" ? doc.nyxidServiceId : null,
    nyxidServiceSlug: typeof doc.nyxidServiceSlug === "string" ? doc.nyxidServiceSlug : null,
    nyxidServiceLabel: typeof doc.nyxidServiceLabel === "string" ? doc.nyxidServiceLabel : null,
    isSystemSkill: doc.isSystemSkill === true,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
