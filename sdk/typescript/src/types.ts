/**
 * Public types for the Ornn SDK.
 *
 * Shapes mirror what `/api/v1/*` returns; the SDK does not reshape
 * responses, so these types are the authoritative wire format for
 * SDK callers. When the ornn-api contract changes, bump this package.
 *
 * @module types
 */

export type Visibility = "public" | "private";
export type SearchScope = "public" | "private" | "mine" | "mixed" | "shared-with-me";

/**
 * Access level a grant confers (#1123). `read` allows pull/execute;
 * `read_write` additionally allows publishing new versions / editing.
 */
export type SkillPermissionLevel = "read" | "read_write";

/**
 * One typed ACL entry (#1123) — the canonical sharing primitive for
 * skills and skillsets. Grants a single user or org a specific access
 * level. Supersedes the legacy `sharedWith*` arrays (which the server
 * still accepts, mapping each entry to a `read`-level grant).
 */
export interface SkillGrant {
  /** Whether the grant targets an individual user or a whole org. */
  readonly type: "user" | "org";
  /** The user or org id the grant applies to. */
  readonly id: string;
  /** The access level conferred. */
  readonly level: SkillPermissionLevel;
}

/** Minimal skill summary as returned by search results. */
export interface SkillSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isPrivate: boolean;
  readonly isSystem?: boolean;
  readonly createdBy: string;
  readonly createdOn: string;
  readonly updatedOn?: string;
  readonly latestVersion?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Full skill detail returned by single-skill reads. */
export interface SkillDetail extends SkillSummary {
  readonly storageKey?: string;
  readonly sharedWithUsers?: readonly string[];
  readonly sharedWithOrgs?: readonly string[];
  /** Canonical typed ACL (#1123). Present on detail reads post-#1123. */
  readonly grants?: readonly SkillGrant[];
}

export interface SkillVersionEntry {
  readonly version: string;
  readonly hash?: string;
  readonly createdOn: string;
  readonly isLatest?: boolean;
  readonly isDeprecated?: boolean;
  readonly deprecationNote?: string;
}

export interface SkillSearchParams {
  /** Free-text query. */
  readonly q?: string;
  /**
   * Which skills to consider. `public` = public marketplace; `mine` =
   * caller-owned (any visibility); `shared-with-me` = skills explicitly
   * shared with the caller; `mixed` = union of public + mine +
   * shared-with-me (default).
   */
  readonly scope?: SearchScope;
  /** Filter by category slug. */
  readonly category?: string;
  /** Filter by tag slug. */
  readonly tag?: string;
  /** Filter by runtime (e.g. `node`, `python`). */
  readonly runtime?: string;
  /** Filter by LLM-suggested retrieval mode. */
  readonly mode?: "keyword" | "semantic" | "hybrid";
  /** Filter by system-skill visibility. */
  readonly systemFilter?: "any" | "only" | "exclude";
  /** 1-indexed page. */
  readonly page?: number;
  /** Page size; server clamps to [1, 100]. Default varies per endpoint. */
  readonly pageSize?: number;
}

export interface SkillSearchResult {
  readonly items: readonly SkillSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly mode?: string;
  /**
   * Cursor pagination envelope per CONVENTIONS.md §4.3 (#457). Use
   * `client.searchAll({ q })` to iterate transparently — the iterator
   * threads `meta.nextCursor` through subsequent requests.
   *
   * When `hasMore === false`, `nextCursor` MAY be omitted.
   */
  readonly meta?: {
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextCursor?: string;
  };
}

/**
 * One node in a resolved dependency closure (#968). Mirrors the items
 * returned by `GET /api/v1/skills/:idOrName/closure`. Nodes arrive in
 * deps-first topological order — every dependency precedes the
 * dependents that pin it, so installing in array order is always safe.
 */
export interface ClosureNode {
  readonly guid: string;
  readonly name: string;
  readonly version: string;
  readonly skillHash?: string;
  /** 0 for the skill's direct dependencies; deeper for transitive deps. */
  readonly depth: number;
}

/** Result of {@link OrnnClient.resolveClosure} — the ordered closure. */
export interface ClosureResult {
  readonly items: readonly ClosureNode[];
}

export interface UpdateSkillMetadata {
  readonly name?: string;
  readonly description?: string;
  readonly isPrivate?: boolean;
  readonly metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Skillsets (#969)
// ---------------------------------------------------------------------------

/**
 * Skillset kind. A `consensus-supported` skillset is an author CLAIM that
 * the members are an independent, comparable set suitable for agent-side
 * consensus — not a guarantee. `generic` is a plain curated bundle.
 */
export type SkillsetKind = "generic" | "consensus-supported";

/** Full skillset detail returned by single-skillset reads. */
export interface SkillsetDetail {
  readonly guid: string;
  readonly name: string;
  readonly description: string;
  /**
   * The skillset **master prompt** (#978) — a markdown body telling an
   * agent HOW to use the set (orchestration, ordering, which member to
   * pick when). Per-version and surfaced verbatim.
   */
  readonly instructions: string;
  readonly kind: SkillsetKind;
  readonly tags: readonly string[];
  /** Member skill refs (`<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`). */
  readonly members: readonly string[];
  readonly version: string;
  readonly latestVersion: string;
  readonly isPrivate: boolean;
  readonly createdBy: string;
  readonly sharedWithUsers?: readonly string[];
  readonly sharedWithOrgs?: readonly string[];
  /** Canonical typed ACL (#1123). Present on detail reads post-#1123. */
  readonly grants?: readonly SkillGrant[];
  readonly createdOn: string;
  readonly updatedOn: string;
}

/** Lighter skillset summary returned by search. */
export interface SkillsetSummary {
  readonly guid: string;
  readonly name: string;
  readonly description: string;
  readonly kind: SkillsetKind;
  readonly tags: readonly string[];
  readonly memberCount: number;
  readonly latestVersion: string;
  readonly isPrivate: boolean;
  readonly createdBy: string;
  readonly createdOn: string;
  readonly updatedOn: string;
}

/** Payload for `client.createSkillset(...)`. */
export interface CreateSkillsetInput {
  readonly name: string;
  readonly description: string;
  /**
   * Master prompt (#978) — REQUIRED. A markdown body telling agents HOW to
   * use the set. 1..8000 chars (trimmed server-side).
   */
  readonly instructions: string;
  /** Defaults to `generic` server-side when omitted. */
  readonly kind?: SkillsetKind;
  readonly tags?: readonly string[];
  /** 2..N member skill refs. */
  readonly members: readonly string[];
  /** Initial version (`<major>.<minor>`). Defaults to `1.0` server-side. */
  readonly version?: string;
}

/** Payload for `client.publishSkillset(id, ...)` — a new immutable version. */
export interface PublishSkillsetInput {
  readonly description?: string;
  /**
   * Master prompt (#978) — REQUIRED on publish too, with NO carry-forward.
   * Each version explicitly carries its own prompt (unlike `description`,
   * which inherits the prior value when omitted).
   */
  readonly instructions: string;
  readonly kind?: SkillsetKind;
  readonly tags?: readonly string[];
  readonly members: readonly string[];
  readonly version: string;
}

/**
 * Result of {@link OrnnClient.getSkillsetClosure} (#978) — the resolved
 * delivery closure PLUS the version's master prompt.
 *
 * A dedicated type (NOT the shared {@link ClosureResult}): the skillset
 * closure carries `instructions` as a root sibling of `items`, while the
 * skill closure (#968) stays `{ items }`.
 */
export interface SkillsetClosureResult {
  /** The version's master prompt (#978) — surfaced verbatim. */
  readonly instructions: string;
  /** Deps-first topo-sorted closure (the shared #968 node shape). */
  readonly items: readonly ClosureNode[];
}

/**
 * Payload for the permissions setters (#1123). Shared by skills and
 * skillsets — `PUT /skills/:id/permissions` and
 * `PUT /skillsets/:id/permissions` take the identical body.
 *
 * `grants` is the canonical ACL. The legacy `sharedWith*` arrays are
 * still accepted by the server and map to `read`-level grants; prefer
 * `grants` for new code.
 */
export interface PermissionsInput {
  readonly isPrivate: boolean;
  /** Canonical typed ACL (#1123) — preferred over the `sharedWith*` arrays. */
  readonly grants?: readonly SkillGrant[];
  readonly sharedWithUsers?: readonly string[];
  readonly sharedWithOrgs?: readonly string[];
}

/** Payload for `client.setSkillPermissions(id, ...)` (#1123). */
export type SkillPermissionsInput = PermissionsInput;

/** Payload for `client.setSkillsetPermissions(id, ...)`. */
export type SkillsetPermissionsInput = PermissionsInput;

export interface SkillsetSearchParams {
  /** Filter by kind (e.g. `consensus-supported`). */
  readonly kind?: SkillsetKind;
  /** Which skillsets to consider — same scopes as skill search. */
  readonly scope?: SearchScope;
  /** Filter by tag(s) — server matches ALL listed tags. */
  readonly tag?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SkillsetSearchResult {
  readonly items: readonly SkillsetSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly meta?: {
    readonly limit: number;
    readonly hasMore: boolean;
    readonly nextCursor?: string;
  };
}

export interface PublishOptions {
  /** Bypass format validation. Admin-only. */
  readonly skipValidation?: boolean;
}
