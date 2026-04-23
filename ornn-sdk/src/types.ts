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
  readonly ownerId: string;
  readonly storageKey?: string;
  readonly sharedWithUsers?: readonly string[];
  readonly sharedWithOrgs?: readonly string[];
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
}

export interface UpdateSkillMetadata {
  readonly name?: string;
  readonly description?: string;
  readonly isPrivate?: boolean;
  readonly metadata?: Record<string, unknown>;
}

export interface PublishOptions {
  /** Bypass format validation. Admin-only. */
  readonly skipValidation?: boolean;
}
