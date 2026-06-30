/**
 * Skillset identity repository — the `skillsets` collection (#969).
 *
 * Thin Mongo wrapper mirroring `SkillRepository` for the skillset
 * identity document. Keys each skillset by its UUID-string `_id` (the
 * public GUID), exactly like skills. Discovery is keyed off the derived
 * `memberVisibilityState` (#1136) — NOT the shared skill `scopeFilter`,
 * which assumes owner-set `isPrivate`: a skillset has no owner-set
 * visibility, so cheap scopes (`public`/`mine`) paginate exactly while
 * live scopes (`private`/`mixed`/`shared-with-me`) return candidates the
 * service live-filters per caller. Adds `kind` equality + `tags $all`.
 *
 * @module domains/skillsets/repository
 */

import type { Collection, Db, Document } from "mongodb";
import { AppError } from "../../shared/types/index";
import { createLogger } from "../../shared/logger";
import { coerceStoredGrants, legacyListsFromGrants } from "../skills/crud/grants";
import type { SkillGrant } from "../../shared/types/index";
import { SkillsetVersionRepository } from "./skillsetVersionRepository";
import type {
  SkillsetDocument,
  SkillsetKind,
  SkillsetMemberVisibilityState,
  SkillsetPluginOverrides,
} from "./types";

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
  /** Initial typed grants (#1123). Omitted for a fresh skillset (born empty). */
  grants?: SkillGrant[] | undefined;
  /** Initial version, e.g. "1.0". Required. */
  latestVersion: string;
  /** Owner opt-in (#1155) to export as a multi-skill plugin. Default OFF. */
  exportAsPlugin?: boolean | undefined;
  /** Owner plugin listing overrides (#1157). Omitted ⇒ no overrides stored. */
  pluginConfig?: SkillsetPluginOverrides | undefined;
}

export interface UpdateSkillsetData {
  description?: string;
  kind?: SkillsetKind;
  tags?: string[];
  isPrivate?: boolean;
  /** @deprecated (#1123) Prefer `grants`; still dual-written for rolling-deploy read compat. */
  sharedWithUsers?: string[];
  /** @deprecated (#1123) Prefer `grants`. */
  sharedWithOrgs?: string[];
  /**
   * Full replacement of the typed grants (#1123). Canonical ACL write — when
   * set, `update` dual-writes the legacy lists from it. Mirrors skills.
   */
  grants?: SkillGrant[];
  latestVersion?: string;
  updatedBy: string;
  /**
   * Owner opt-in (#1155). Set ONLY when an explicit boolean is provided —
   * omitting it preserves the skillset's current setting (a publish that
   * doesn't mention the flag must not silently reset it).
   */
  exportAsPlugin?: boolean;
  /**
   * Owner plugin listing overrides (#1157). Three-state:
   *   - `undefined` — leave the stored overrides untouched (publish path).
   *   - object      — replace the stored overrides with these fields.
   *   - `null`      — `$unset` the overrides (fall back to skillset fields).
   */
  pluginConfig?: SkillsetPluginOverrides | null;
}

/** Filters specific to skillset search: `kind` equality + `tags $all` + a `q`
 * case-insensitive substring match on name/description. */
export interface SkillsetSearchFilters {
  kind?: SkillsetKind | undefined;
  tagsAll?: string[] | undefined;
  /** Free-text keyword — matched (case-insensitive) against name + description. */
  q?: string | undefined;
}

export class SkillsetRepository {
  private readonly collection: Collection;
  /** Server-side cap on paginated reads (mirrors SkillRepository). */
  private static readonly MAX_QUERY_MS = 5_000;
  /**
   * Append-only version repo (#1159). Injected so the targeted mirror
   * re-export can ask "which skillsets reference this member skill?" via the
   * version collection's multikey `members` index, then narrow to the
   * export-eligible identity docs here.
   */
  private readonly versionRepo: SkillsetVersionRepository;

  constructor(db: Db, versionRepo: SkillsetVersionRepository) {
    this.collection = db.collection("skillsets");
    this.versionRepo = versionRepo;
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
      // #1155 — fast lookup of plugin-export-eligible skillsets for the mirror.
      this.collection.createIndex({ exportAsPlugin: 1, memberVisibilityState: 1 }),
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

  /**
   * Skillsets eligible to export as a curated multi-skill plugin (#1155):
   * every member public (`memberVisibilityState: "all-public"`) AND the owner
   * opted in (`exportAsPlugin: true`). The all-public guarantee is what makes
   * publishing the member content to the public mirror safe. Used by the
   * mirror sweep + the shared marketplace.json refresh.
   */
  async findAllEligibleForMirror(): Promise<SkillsetDocument[]> {
    const docs = await this.collection
      .find({ memberVisibilityState: "all-public", exportAsPlugin: true })
      .maxTimeMS(SkillsetRepository.MAX_QUERY_MS)
      .toArray();
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Export-eligible skillsets that reference the given skill as a member of
   * ANY version (#1159). Powers the targeted mirror re-export: when a member
   * skill publishes a new version or moves a dist-tag, ONLY the skillsets that
   * actually reference it are rebuilt — not a full sweep.
   *
   * Backed by the version repo's multikey `members` index
   * (`findSkillsetGuidsByMember`, which matches by name OR guid across every
   * ref grammar), then narrowed to the SAME eligibility predicate as
   * {@link findAllEligibleForMirror} (`memberVisibilityState: "all-public"`
   * AND `exportAsPlugin: true`). The all-public narrowing is load-bearing: a
   * content change must never leak a non-public skillset's member subtree into
   * the public mirror.
   */
  async findEligibleSkillsetsByMember(
    skillName: string,
    skillGuid: string,
  ): Promise<SkillsetDocument[]> {
    const guids = await this.versionRepo.findSkillsetGuidsByMember(skillName, skillGuid);
    if (guids.length === 0) return [];
    const docs = await this.collection
      .find({
        _id: { $in: guids } as never,
        memberVisibilityState: "all-public",
        exportAsPlugin: true,
      })
      .maxTimeMS(SkillsetRepository.MAX_QUERY_MS)
      .toArray();
    logger.debug(
      { skillName, candidates: guids.length, eligible: docs.length },
      "findEligibleSkillsetsByMember resolved",
    );
    return docs.map((d) => mapDoc(d)!);
  }

  /**
   * Every skillset guid (the `_id`). Used by the one-shot derived-visibility
   * backfill (#1136) to recompute the cache for pre-existing skillsets.
   * Projection-only, so it stays cheap even at scale.
   */
  async listAllGuids(): Promise<string[]> {
    const rows = await this.collection.find({}).project({ _id: 1 }).toArray();
    return rows.map((r) => r._id as string);
  }

  async create(data: CreateSkillsetData): Promise<SkillsetDocument> {
    const now = new Date();
    const initialGrants = data.grants ?? [];
    const legacy = legacyListsFromGrants(initialGrants);
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
      // Born "migrated" (#1123): empty typed grants + legacy lists in lock-step.
      grants: initialGrants,
      sharedWithUsers: legacy.sharedWithUsers,
      sharedWithOrgs: legacy.sharedWithOrgs,
      // Derived visibility (#1136) — seeded all-public; the service recomputes
      // from the actual members right after create/publish.
      membersAllPublic: true,
      memberVisibilityState: "all-public",
      // Plugin-export opt-in (#1155) — default OFF.
      exportAsPlugin: data.exportAsPlugin ?? false,
      latestVersion: data.latestVersion,
    };
    // Plugin listing overrides (#1157) — only written when supplied so a fresh
    // skillset has no `pluginConfig` field at all (mirror falls back to fields).
    if (data.pluginConfig) doc.pluginConfig = data.pluginConfig;

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
    // Typed grants are the canonical ACL write (#1123); dual-write legacy
    // lists from them. Legacy `sharedWith*` apply only when `grants` is absent.
    if (data.grants !== undefined) {
      const legacy = legacyListsFromGrants(data.grants);
      setFields.grants = data.grants;
      setFields.sharedWithUsers = legacy.sharedWithUsers;
      setFields.sharedWithOrgs = legacy.sharedWithOrgs;
    } else {
      if (data.sharedWithUsers !== undefined) setFields.sharedWithUsers = data.sharedWithUsers;
      if (data.sharedWithOrgs !== undefined) setFields.sharedWithOrgs = data.sharedWithOrgs;
    }
    if (data.latestVersion !== undefined) setFields.latestVersion = data.latestVersion;
    // #1155 — only an explicit boolean flips the opt-in; omission preserves it.
    if (data.exportAsPlugin !== undefined) setFields.exportAsPlugin = data.exportAsPlugin;
    // #1157 — three-state plugin overrides: object replaces, null clears
    // ($unset so the mirror falls back to skillset fields), undefined no-ops.
    const unsetFields: Record<string, unknown> = {};
    if (data.pluginConfig === null) {
      unsetFields.pluginConfig = "";
    } else if (data.pluginConfig !== undefined) {
      setFields.pluginConfig = data.pluginConfig;
    }

    const updateDoc: Record<string, unknown> = { $set: setFields };
    if (Object.keys(unsetFields).length > 0) updateDoc.$unset = unsetFields;
    await this.collection.updateOne({ _id: skillsetId(guid) }, updateDoc);
    logger.info({ guid }, "Skillset updated");
    return (await this.findByGuid(guid))!;
  }

  /**
   * Write ONLY the derived-visibility cache (#1136). Deliberately does NOT
   * touch `updatedBy` / `updatedOn`: these flags are a denormalized
   * reflection of the member skills' own privacy, recomputed reactively
   * whenever a member skill changes — not a user edit of the skillset, so
   * they must not move the skillset's audit timestamps.
   */
  async setDerivedVisibility(
    guid: string,
    derived: {
      membersAllPublic: boolean;
      memberVisibilityState: SkillsetMemberVisibilityState;
    },
  ): Promise<void> {
    await this.collection.updateOne(
      { _id: skillsetId(guid) },
      {
        $set: {
          membersAllPublic: derived.membersAllPublic,
          memberVisibilityState: derived.memberVisibilityState,
        },
      },
    );
    logger.debug(
      { guid, memberVisibilityState: derived.memberVisibilityState },
      "Skillset derived visibility recomputed",
    );
  }

  /**
   * Reassign a skillset's owner (#1123). Mirrors `SkillRepository`: the
   * single explicit `createdBy` write, refreshing cached owner labels and
   * replacing the ACL with the caller-computed grants (dual-writing legacy).
   */
  async transferOwnership(
    guid: string,
    data: {
      newOwnerId: string;
      newOwnerEmail: string | null;
      newOwnerDisplayName: string | null;
      grants: SkillGrant[];
      updatedBy: string;
    },
  ): Promise<SkillsetDocument> {
    const legacy = legacyListsFromGrants(data.grants);
    await this.collection.updateOne(
      { _id: skillsetId(guid) },
      {
        $set: {
          createdBy: data.newOwnerId,
          createdByEmail: data.newOwnerEmail,
          createdByDisplayName: data.newOwnerDisplayName,
          grants: data.grants,
          sharedWithUsers: legacy.sharedWithUsers,
          sharedWithOrgs: legacy.sharedWithOrgs,
          updatedBy: data.updatedBy,
          updatedOn: new Date(),
        },
      },
    );
    logger.info({ guid, newOwnerId: data.newOwnerId }, "Skillset ownership transferred");
    return (await this.findByGuid(guid))!;
  }

  async hardDelete(guid: string): Promise<void> {
    await this.collection.deleteOne({ _id: skillsetId(guid) });
    logger.info({ guid }, "Skillset hard-deleted");
  }

  /**
   * Build the content-filter clauses shared by every scope: `kind`
   * equality, `tags $all`, and a case-insensitive `q` substring on
   * name/description. Regex metachars in `q` are escaped so user input
   * can't inject a (potentially catastrophic) pattern.
   */
  private buildContentFilters(filters?: SkillsetSearchFilters): Array<Record<string, unknown>> {
    const clauses: Array<Record<string, unknown>> = [];
    if (filters?.kind) clauses.push({ kind: filters.kind });
    if (filters?.tagsAll && filters.tagsAll.length > 0) {
      clauses.push({ tags: { $all: filters.tagsAll } });
    }
    if (filters?.q && filters.q.trim().length > 0) {
      const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      clauses.push({
        $or: [
          { name: { $regex: safe, $options: "i" } },
          { description: { $regex: safe, $options: "i" } },
        ],
      });
    }
    return clauses;
  }

  /**
   * Exact-paginated read for the scopes that need NO live member check
   * (#1136): visibility is decided purely by denormalized fields, so Mongo
   * paginates exactly (fast-path).
   *   - `public` → all-public skillsets (readable by everyone, incl. anon).
   *   - `mine`   → the caller's own skillsets, any visibility state.
   */
  async findCheapScope(
    scope: "public" | "mine",
    caller: string,
    page: number,
    pageSize: number,
    filters?: SkillsetSearchFilters,
  ): Promise<{ skillsets: SkillsetDocument[]; total: number }> {
    const clauses = this.buildContentFilters(filters);
    if (scope === "public") {
      clauses.push({ memberVisibilityState: "all-public" });
    } else {
      // `mine` for an anonymous caller matches nothing.
      if (!caller) return { skillsets: [], total: 0 };
      clauses.push({ createdBy: caller });
    }
    const match = clauses.length === 1 ? clauses[0]! : { $and: clauses };

    const total = await this.collection.countDocuments(match, {
      maxTimeMS: SkillsetRepository.MAX_QUERY_MS,
    });
    const offset = (page - 1) * pageSize;
    const docs = await this.collection
      .find(match)
      .sort({ createdOn: -1 })
      .skip(offset)
      .limit(pageSize)
      .maxTimeMS(SkillsetRepository.MAX_QUERY_MS)
      .toArray();
    return { skillsets: docs.map((d) => mapDoc(d)!), total };
  }

  /**
   * Candidate docs for the scopes that REQUIRE a live per-caller member
   * readability check (#1136): `private`, `mixed`, `shared-with-me`. The
   * caller (search service) live-filters these against the actor and then
   * paginates in-memory. Returns up to `cap` candidates (newest first); the
   * `capped` flag is `true` when the candidate set was truncated so the
   * caller can log it (no silent truncation).
   *
   * The Mongo prefilter is the cheapest SUPERSET of what the live check
   * admits:
   *   - shared-with-me → restricted skillsets authored by someone else.
   *   - private        → caller's own (non-public) ∪ restricted-by-others.
   *   - mixed          → all-public ∪ caller's own (non-public) ∪ restricted-by-others.
   * `unresolvable` skillsets are excluded from others' discovery — only the
   * owner sees them, via the `mine` scope.
   */
  async findLiveScopeCandidates(
    scope: "private" | "mixed" | "shared-with-me",
    caller: string,
    filters: SkillsetSearchFilters | undefined,
    cap: number,
  ): Promise<{ candidates: SkillsetDocument[]; capped: boolean }> {
    const clauses = this.buildContentFilters(filters);
    const restrictedByOthers: Record<string, unknown> = caller
      ? { memberVisibilityState: "restricted", createdBy: { $ne: caller } }
      : { memberVisibilityState: "restricted" };

    const scopeOr: Array<Record<string, unknown>> = [];
    if (scope === "shared-with-me") {
      // Strictly skillsets the caller did NOT author; anon has none.
      if (!caller) return { candidates: [], capped: false };
      scopeOr.push(restrictedByOthers);
    } else {
      // private + mixed: the caller's own non-public skillsets always show
      // (theirs — no live check); restricted-by-others are live-checked.
      if (caller) scopeOr.push({ createdBy: caller, memberVisibilityState: { $ne: "all-public" } });
      scopeOr.push(restrictedByOthers);
      if (scope === "mixed") scopeOr.push({ memberVisibilityState: "all-public" });
    }
    clauses.push(scopeOr.length === 1 ? scopeOr[0]! : { $or: scopeOr });
    const match = clauses.length === 1 ? clauses[0]! : { $and: clauses };

    // Over-fetch one past the cap to detect (and report) truncation.
    const docs = await this.collection
      .find(match)
      .sort({ createdOn: -1 })
      .limit(cap + 1)
      .maxTimeMS(SkillsetRepository.MAX_QUERY_MS)
      .toArray();
    const capped = docs.length > cap;
    return { candidates: docs.slice(0, cap).map((d) => mapDoc(d)!), capped };
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
    // Typed grants (#1123) — undefined on un-migrated docs (callers use
    // `effectiveGrants` to fall back to the legacy lists).
    grants: coerceStoredGrants(doc.grants),
    // Derived visibility (#1136). Absent on un-backfilled docs → treat as
    // all-public (the pre-#1136 default) so reads stay clean until backfill.
    membersAllPublic: doc.membersAllPublic === undefined ? true : doc.membersAllPublic === true,
    memberVisibilityState:
      (doc.memberVisibilityState as SkillsetMemberVisibilityState | undefined) ?? "all-public",
    // Plugin-export opt-in (#1155) — absent on pre-feature docs ⇒ false.
    exportAsPlugin: doc.exportAsPlugin === true,
    // Plugin listing overrides (#1157) — undefined when unset/legacy.
    pluginConfig: coercePluginConfig(doc.pluginConfig),
    latestVersion: doc.latestVersion ?? "1.0",
  };
}

/**
 * Defensively coerce a stored `pluginConfig` (#1157) into the typed override
 * shape, dropping any field of the wrong type. Returns `undefined` when nothing
 * usable is present so callers can cleanly fall back to the skillset fields.
 */
function coercePluginConfig(raw: unknown): SkillsetPluginOverrides | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SkillsetPluginOverrides = {};
  if (typeof r.displayName === "string") out.displayName = r.displayName;
  if (typeof r.description === "string") out.description = r.description;
  if (Array.isArray(r.keywords)) {
    out.keywords = r.keywords.filter((k): k is string => typeof k === "string");
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
