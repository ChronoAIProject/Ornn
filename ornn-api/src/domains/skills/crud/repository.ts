/**
 * Skill CRUD repository. Uses storageKey instead of s3Url.
 * @module domains/skills/crud/repository
 */

import type { Collection, Db, Document } from "mongodb";
import type { SkillDocument, SkillGrant, SkillMetadata } from "../../../shared/types/index";
import { AppError } from "../../../shared/types/index";
import { createLogger } from "../../../shared/logger";
import { legacyListsFromGrants } from "./grants";
// `applyScope` / `applyExtraFilters` were lifted into `scopeFilter.ts`
// (#969) so the skillsets repository can reuse the exact same visibility
// matrix + registry-chip filters. Re-import them here — pure move, no
// behaviour change.
import { applyScope, applyExtraFilters } from "./scopeFilter";
import type { ExtraFilters as ScopeExtraFilters } from "./scopeFilter";
/**
 * Coerce a string GUID into the shape MongoDB's driver expects for
 * `_id` queries on the skills collection (#448). The collection uses
 * UUID strings instead of `ObjectId`s; the driver's filter typing
 * (`ObjectId | string` discriminator) doesn't see that without help.
 *
 * One named helper instead of `as any` at every call site:
 *   - validates the input (empty string would silently match zero
 *     docs, the failure mode the issue flagged)
 *   - keeps the necessary cast in a single, named place
 *
 * Return type is `never` so the call site accepts both `findOne`
 * filters and `insertOne` documents — the actual stored value is a
 * string, but the driver's type slot is `ObjectId`.
 */
function skillId(guid: string): never {
  if (typeof guid !== "string" || guid.length === 0) {
    throw AppError.badRequest(
      "invalid_skill_id",
      "Skill id must be a non-empty string",
    );
  }
  return guid as never;
}

/** Same shape for `$in` filters on `_id`. Validates each guid up front. */
function skillIdList(guids: readonly string[]): never {
  for (const g of guids) {
    if (typeof g !== "string" || g.length === 0) {
      throw AppError.badRequest(
        "invalid_skill_id",
        "Skill id must be a non-empty string",
      );
    }
  }
  return guids as never;
}

const logger = createLogger("skillCrudRepository");

// Optionals widen to `T | undefined` so route layers passing Zod-
// inferred or other optional inputs fit under
// exactOptionalPropertyTypes (#657). Repo writes ignore undefined keys.
export interface CreateSkillData {
  guid: string;
  name: string;
  description: string;
  license?: string | undefined;
  compatibility?: string | undefined;
  metadata: SkillMetadata;
  skillHash: string;
  storageKey: string;
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  isPrivate?: boolean | undefined;
  /**
   * Initial typed grants (#1123). Omitted for a fresh skill — new skills are
   * born private with no grants; the create path seeds an empty array.
   */
  grants?: SkillGrant[] | undefined;
  /** Initial version, e.g. "1.0". Required. */
  latestVersion: string;
  /** Origin metadata when the skill was created via a pull from an external source. */
  source?: import("../../../shared/types/index").SkillSource | undefined;
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
   *
   * @deprecated (#1123) Prefer `grants`. Still written for the transitional
   * dual-write so older pods keep resolving read visibility; the permission
   * path derives these from `grants` rather than setting them directly.
   */
  sharedWithUsers?: string[];
  /** Full replacement of the explicit per-org grant list. @deprecated — see `grants`. */
  sharedWithOrgs?: string[];
  /**
   * Full replacement of the typed grants (#1123). The canonical ACL write.
   * When set, `update` also dual-writes the legacy `sharedWithUsers` /
   * `sharedWithOrgs` lists (every grant id, read visibility) so a rolling
   * deploy stays non-disruptive. When undefined the existing value is kept.
   */
  grants?: SkillGrant[];
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
 * when the UI chips are active. Re-exported from `scopeFilter.ts` (#969)
 * so existing importers of `./repository` keep working unchanged.
 */
export type ExtraFilters = ScopeExtraFilters;

export class SkillRepository {
  private readonly collection: Collection;

  /**
   * Server-side cap on paginated reads. Bounds the worst-case
   * `.skip()` scan + its paired `countDocuments` so a deep page (even
   * within the clamped page ceiling) can't tie up a Mongo worker for
   * an unbounded stretch (CWE-770, #810). Mirrors admin/routes.ts.
   */
  private static readonly MAX_QUERY_MS = 5_000;

  constructor(db: Db) {
    this.collection = db.collection("skills");
  }

  /**
   * Ensure indexes the skill collection relies on. Idempotent —
   * MongoDB's createIndex is a no-op when the index already exists
   * with the same key + options. Called from bootstrap on startup.
   *
   * The `name` + `description` indexes feed both the admin regex
   * search (#446) and the keyword + skill-detail lookups in
   * service.ts.
   */
  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ name: 1 }, { unique: true }),
      // Partial regex queries can't use a btree index on a long text
      // field, but having the field indexed at all lets the query
      // planner skip the COLLSCAN when the regex is anchored or when
      // the secondary `createdBy` / `isPrivate` filter is present.
      this.collection.createIndex({ description: 1 }),
      this.collection.createIndex({ createdBy: 1, createdOn: -1 }),
      this.collection.createIndex({ createdOn: -1 }),
      this.collection.createIndex({ isPrivate: 1, createdOn: -1 }),
    ]);
  }

  async findByGuid(guid: string): Promise<SkillDocument | null> {
    const doc = await this.collection.findOne({ _id: skillId(guid) });
    return mapDoc(doc);
  }

  async findByName(name: string): Promise<SkillDocument | null> {
    const doc = await this.collection.findOne({ name });
    return mapDoc(doc);
  }

  async create(data: CreateSkillData): Promise<SkillDocument> {
    const now = new Date();
    const initialGrants = data.grants ?? [];
    const legacy = legacyListsFromGrants(initialGrants);
    const doc: Record<string, unknown> = {
      _id: skillId(data.guid),
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
      // Explicit ACLs start empty — author + platform admin always have
      // access; the grants list is an additive allow-list. New skills are
      // born "migrated" (#1123): an empty `grants` array plus the legacy
      // lists kept in lock-step for the transitional dual-write.
      grants: initialGrants,
      sharedWithUsers: legacy.sharedWithUsers,
      sharedWithOrgs: legacy.sharedWithOrgs,
      latestVersion: data.latestVersion,
    };

    if (data.source) {
      doc.source = data.source;
    }

    try {
      await this.collection.insertOne(doc);
      logger.info({ guid: data.guid, name: data.name }, "Skill created");
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === 11000) {
        throw AppError.conflict("skill_name_exists", `Skill '${data.name}' already exists`);
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
    // Typed grants are the canonical write (#1123). When provided, dual-write
    // the legacy lists from them (every grant id → read visibility) so an
    // older pod mid-rolling-deploy still resolves correct read access. An
    // explicit `sharedWith*` on the update wins only when `grants` is absent
    // (legacy callers / un-migrated paths).
    if (data.grants !== undefined) {
      const legacy = legacyListsFromGrants(data.grants);
      setFields.grants = data.grants;
      setFields.sharedWithUsers = legacy.sharedWithUsers;
      setFields.sharedWithOrgs = legacy.sharedWithOrgs;
    } else {
      if (data.sharedWithUsers !== undefined) setFields.sharedWithUsers = data.sharedWithUsers;
      if (data.sharedWithOrgs !== undefined) setFields.sharedWithOrgs = data.sharedWithOrgs;
    }
    if (data.source !== undefined) setFields.source = data.source;
    if (data.latestVersion !== undefined) setFields.latestVersion = data.latestVersion;

    await this.collection.updateOne({ _id: skillId(guid) }, { $set: setFields });
    logger.info({ guid }, "Skill updated");
    return (await this.findByGuid(guid))!;
  }

  /**
   * Set a single dist-tag (#463) atomically via `$set` on a dotted path.
   * Doesn't validate that `version` exists — that's the service's job;
   * the repo just writes whatever's handed in.
   */
  async setDistTag(guid: string, tag: string, version: string): Promise<void> {
    await this.collection.updateOne(
      { _id: skillId(guid) },
      { $set: { [`distTags.${tag}`]: version, updatedOn: new Date() } },
    );
    logger.info({ guid, tag, version }, "Dist-tag set");
  }

  /**
   * Remove a single dist-tag (#463). `$unset` on a dotted path leaves
   * sibling tags intact; if the resulting object would be empty the
   * field stays as `{}` (mongo cleans it up on the next full doc
   * write). Callers that care about empty-object cleanup can
   * subsequently `$unset` the parent.
   */
  async deleteDistTag(guid: string, tag: string): Promise<void> {
    await this.collection.updateOne(
      { _id: skillId(guid) },
      { $unset: { [`distTags.${tag}`]: "" }, $set: { updatedOn: new Date() } },
    );
    logger.info({ guid, tag }, "Dist-tag deleted");
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: skillId(guid) });
    logger.info({ guid }, "Skill hard-deleted");
  }

  /**
   * Remove the `source` field entirely from a skill doc (i.e. unlink the
   * upstream pointer). Use $unset rather than `$set: { source: null }` so
   * the field is absent from the doc — matches the "originally hand-
   * uploaded skill" shape.
   */
  async clearSource(guid: string, updatedBy: string): Promise<SkillDocument | null> {
    await this.collection.updateOne(
      { _id: skillId(guid) },
      {
        $set: { updatedBy, updatedOn: new Date() },
        $unset: { source: "" },
      },
    );
    return this.findByGuid(guid);
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
    await this.collection.updateOne({ _id: skillId(guid) }, { $set: setFields });
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

    const total = await this.collection.countDocuments(matchStage, {
      maxTimeMS: SkillRepository.MAX_QUERY_MS,
    });
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .maxTimeMS(SkillRepository.MAX_QUERY_MS)
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

    const total = await this.collection.countDocuments(matchStage, {
      maxTimeMS: SkillRepository.MAX_QUERY_MS,
    });
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .maxTimeMS(SkillRepository.MAX_QUERY_MS)
      .toArray();

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

    const total = await this.collection.countDocuments(matchStage, {
      maxTimeMS: SkillRepository.MAX_QUERY_MS,
    });
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(matchStage)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .maxTimeMS(SkillRepository.MAX_QUERY_MS)
      .toArray();

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
      .project({ _id: 1, name: 1, description: 1, metadata: 1, isPrivate: 1, sharedWithUsers: 1, sharedWithOrgs: 1, createdBy: 1, createdByEmail: 1, createdByDisplayName: 1, createdOn: 1, updatedOn: 1, storageKey: 1, skillHash: 1, license: 1, compatibility: 1, updatedBy: 1 })
      .sort({ createdOn: -1 })
      .toArray();

    return docs.map((d) => mapDoc(d)!);
  }

  async findByGuids(guids: string[]): Promise<SkillDocument[]> {
    if (guids.length === 0) return [];
    const docs = await this.collection.find({ _id: { $in: skillIdList(guids) } }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Skills that should be reflected on the GitHub mirror — strictly
   * `isPrivate: false`. System skills (admin-NyxID-service-tied) are a
   * subset of this since `isSystemSkill: true` enforces `isPrivate:
   * false` at the tie-time invariant. The query is intentionally
   * narrow: ANY mismatch between this predicate and the mirror's
   * eligibility check would leak private skills onto a public GitHub
   * repo, so the predicate stays in one place
   * (`MirrorService.isEligible`) and this query mirrors it exactly.
   */
  async findAllEligibleForMirror(): Promise<SkillDocument[]> {
    const docs = await this.collection.find({ isPrivate: false }).toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Stamp `mirrorSync` on a single skill after a successful publish or
   * reconcile commit lands on the GitHub mirror. `syncedAt` is wall-clock
   * server time; `commitSha` is the GitHub commit SHA so the UI can build
   * an audit link `<owner>/<repo>/commit/<sha>`.
   *
   * Pass `null` to clear the field (skill removed from mirror — e.g.
   * flipped private, deleted, or admin reset).
   */
  async setMirrorSyncState(
    guid: string,
    state: { version: string; syncedAt: Date; commitSha: string } | null,
  ): Promise<void> {
    if (state === null) {
      await this.collection.updateOne({ _id: guid as unknown as Document["_id"] }, {
        $unset: { mirrorSync: "" },
      });
      return;
    }
    await this.collection.updateOne({ _id: guid as unknown as Document["_id"] }, {
      $set: { mirrorSync: state },
    });
  }

  /**
   * Bulk variant for `MirrorService.reconcileAll`. One MongoDB roundtrip
   * for any number of skills. Each entry sets or unsets the field per
   * the same rules as the single setter.
   */
  async setMirrorSyncStateBulk(
    updates: Array<{
      guid: string;
      state: { version: string; syncedAt: Date; commitSha: string } | null;
    }>,
  ): Promise<void> {
    if (updates.length === 0) return;
    const ops = updates.map(({ guid, state }) =>
      state === null
        ? {
            updateOne: {
              filter: { _id: guid as unknown as Document["_id"] },
              update: { $unset: { mirrorSync: "" } },
            },
          }
        : {
            updateOne: {
              filter: { _id: guid as unknown as Document["_id"] },
              update: { $set: { mirrorSync: state } },
            },
          },
    );
    await this.collection.bulkWrite(ops, { ordered: false });
  }

  /**
   * Clear `mirrorSync` on every skill that has it. Used when an admin
   * re-points the mirror to a different `<owner>/<repo>` — the existing
   * stamps point at commit SHAs in the *old* repo, so the audit links
   * would be wrong if we kept them. Next reconcile re-stamps everything
   * fresh against the new repo.
   */
  async clearAllMirrorSyncStamps(): Promise<void> {
    await this.collection.updateMany(
      { mirrorSync: { $exists: true } },
      { $unset: { mirrorSync: "" } },
    );
  }

  /**
   * Heal stale `mirrorSync` stamps. Any skill that's currently
   * `isPrivate: true` should never carry a mirror stamp — if it does,
   * a privacy-flip hook fired-and-forgot but never landed (process
   * crash, transient GitHub error, etc.). `reconcileAll` calls this
   * at the start of every run so the stamp set converges with reality
   * even when an incremental hook drops on the floor.
   */
  async clearMirrorSyncForIneligibleSkills(): Promise<void> {
    await this.collection.updateMany(
      { isPrivate: true, mirrorSync: { $exists: true } },
      { $unset: { mirrorSync: "" } },
    );
  }

  /**
   * Mirror status counters used by the admin overview. One aggregation
   * pass over the eligible-for-mirror set:
   *   - `eligible` — total public + system skills
   *   - `synced` — eligible skills with `mirrorSync.version === latestVersion`
   *   - `lagging` — eligible skills with stale `mirrorSync.version`
   *   - `neverSynced` — eligible skills with no `mirrorSync` field
   *   - `oldestUnsyncedAt` — `createdOn` of the oldest never-synced skill,
   *     or `null` when nothing is pending. Surfaces "is the cron stuck"
   *     to the operator.
   */
  async getMirrorCounts(): Promise<{
    eligible: number;
    synced: number;
    lagging: number;
    neverSynced: number;
    oldestUnsyncedAt: Date | null;
  }> {
    const docs = await this.collection
      .find({ isPrivate: false })
      .project({ latestVersion: 1, mirrorSync: 1, createdOn: 1 })
      .toArray();
    let synced = 0;
    let lagging = 0;
    let neverSynced = 0;
    let oldestUnsyncedAt: Date | null = null;
    for (const d of docs) {
      if (!d.mirrorSync || typeof d.mirrorSync.version !== "string") {
        neverSynced += 1;
        const createdOn = d.createdOn instanceof Date ? d.createdOn : null;
        if (createdOn && (oldestUnsyncedAt === null || createdOn < oldestUnsyncedAt)) {
          oldestUnsyncedAt = createdOn;
        }
        continue;
      }
      if (d.mirrorSync.version === d.latestVersion) {
        synced += 1;
      } else {
        lagging += 1;
      }
    }
    return {
      eligible: docs.length,
      synced,
      lagging,
      neverSynced,
      oldestUnsyncedAt,
    };
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
    if ((matchStage._id as { $in?: unknown[] } | undefined)?.$in?.length === 0) return 0;
    return this.collection.countDocuments(matchStage);
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
    // Shared-with lists default to empty when the field is absent — that's
    // how every skill predating the ACL feature looks. The migration script
    // explicitly writes [] so future reads don't need this fallback, but
    // we keep it here for safety against partial migrations.
    sharedWithUsers: Array.isArray(doc.sharedWithUsers) ? (doc.sharedWithUsers as string[]) : [],
    sharedWithOrgs: Array.isArray(doc.sharedWithOrgs) ? (doc.sharedWithOrgs as string[]) : [],
    // Typed grants (#1123). Absent on un-migrated docs — left undefined here
    // so the doc faithfully reflects storage; callers use `effectiveGrants`
    // to fall back to read-grants derived from the legacy lists.
    grants: mapGrants(doc.grants),
    latestVersion: doc.latestVersion ?? "0.1",
    source: doc.source
      ? {
          type: "github",
          repo: String(doc.source.repo ?? ""),
          ref: String(doc.source.ref ?? ""),
          path: String(doc.source.path ?? ""),
          // Both fields are optional — when the user attached a GitHub
          // link via PUT /skills/:id/source without an immediate sync,
          // they're absent from the doc. Don't fabricate an Invalid
          // Date by feeding `undefined` to the Date constructor.
          ...(doc.source.lastSyncedAt instanceof Date
            ? { lastSyncedAt: doc.source.lastSyncedAt }
            : doc.source.lastSyncedAt != null
              ? { lastSyncedAt: new Date(doc.source.lastSyncedAt) }
              : {}),
          ...(typeof doc.source.lastSyncedCommit === "string" && doc.source.lastSyncedCommit
            ? { lastSyncedCommit: doc.source.lastSyncedCommit }
            : {}),
        }
      : undefined,
    nyxidServiceId: typeof doc.nyxidServiceId === "string" ? doc.nyxidServiceId : null,
    nyxidServiceSlug: typeof doc.nyxidServiceSlug === "string" ? doc.nyxidServiceSlug : null,
    nyxidServiceLabel: typeof doc.nyxidServiceLabel === "string" ? doc.nyxidServiceLabel : null,
    isSystemSkill: doc.isSystemSkill === true,
    mirrorSync:
      doc.mirrorSync &&
      typeof doc.mirrorSync.version === "string" &&
      typeof doc.mirrorSync.commitSha === "string"
        ? {
            version: doc.mirrorSync.version,
            syncedAt:
              doc.mirrorSync.syncedAt instanceof Date
                ? doc.mirrorSync.syncedAt
                : new Date(doc.mirrorSync.syncedAt),
            commitSha: doc.mirrorSync.commitSha,
          }
        : undefined,
    // Dist-tags (#463). Coerce defensively — pre-#463 docs have no
    // field; corrupted entries with non-string values get filtered.
    distTags: mapDistTags(doc.distTags),
  };
}

/**
 * Coerce the stored `grants` array defensively (#1123). Returns `undefined`
 * when the field is absent (un-migrated doc) so `effectiveGrants` falls back
 * to the legacy lists. Drops malformed entries (bad type/level, blank id)
 * rather than trusting raw Mongo data across the trust boundary.
 */
function mapGrants(raw: unknown): SkillGrant[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SkillGrant[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const type = e.type;
    const id = typeof e.id === "string" ? e.id.trim() : "";
    const level = e.level;
    if ((type !== "user" && type !== "org") || !id) continue;
    if (level !== "read" && level !== "read_write") continue;
    out.push({ type, id, level });
  }
  return out;
}

function mapDistTags(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0) {
      out[k] = v;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
