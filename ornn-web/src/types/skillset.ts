/**
 * Frontend types for the skillsets domain (#1059 web UI for #969 backend).
 *
 * A **skillset** is a named, versioned, owned, visibility-scoped meta-package
 * that references N member skills and carries a `kind`. These types mirror the
 * serialized API shapes from `ornn-api/src/domains/skillsets/types.ts` — the
 * frontend reads them over the local `apiClient`, NOT the SDK.
 *
 * Deliberately NOT aliased to the skill types: a `SkillsetDetail` is a distinct
 * resource (member refs + master prompt, no blob/hash/storage key), and
 * `SkillsetSearchParams` is a much smaller surface than `SkillSearchParams`
 * (kind / tags / scope / page / pageSize only — no semantic mode, no system
 * filter, no author facets).
 *
 * @module types/skillset
 */

import type { SkillGrant } from "@/types/domain";

/**
 * Skillset kind (#969 v1). `generic` is the DEFAULT — a plain curated bundle.
 * `consensus-supported` is an author CLAIM that the members are an
 * independent, comparable set suitable for agent-side consensus (not a
 * guarantee). Extensible: future kinds append here.
 */
export const SKILLSET_KINDS = ["generic", "consensus-supported"] as const;
export type SkillsetKind = (typeof SKILLSET_KINDS)[number];

/** Lower bound on members — a one-member "set" is just a skill. */
export const SKILLSET_MIN_MEMBERS = 2;
/** Upper bound on members — guards against a pathological publish. */
export const SKILLSET_MAX_MEMBERS = 100;

/** Upper bound on the master-prompt body (the per-version usage instructions). */
export const SKILLSET_INSTRUCTIONS_MAX = 8000;

/** Why a master-prompt body is invalid. `null` = valid. */
export type MasterPromptRejection = "empty" | "tooLong" | null;

/**
 * Validate a master-prompt body against the #978 contract. Returns `null` when
 * valid, else a reason key. Trim-then-bound so whitespace-only never satisfies
 * the non-empty requirement.
 */
export function validateMasterPrompt(value: string): MasterPromptRejection {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.length > SKILLSET_INSTRUCTIONS_MAX) return "tooLong";
  return null;
}

/**
 * The one explicit way an author might try to nest a skillset — a
 * `skillset:`-prefixed member ref. Rejected client-side with a clear message
 * before the request leaves the browser (the backend rejects it too).
 */
export const SKILLSET_REF_PREFIX = "skillset:";

/**
 * Serialized skillset detail — GET /api/v1/skillsets/:idOrName.
 * Mirrors `SkillsetDetailResponse`. Carries the resolved version's master
 * prompt (`instructions`) + member refs + the full ACL state.
 */
export interface SkillsetDetail {
  guid: string;
  name: string;
  description: string;
  /** Master prompt (#978) — the per-version usage instructions for agents. */
  instructions: string;
  kind: SkillsetKind;
  tags: string[];
  /** Member skill refs (`<name-or-guid>@<major.minor>` or `<name>@<dist-tag>`). */
  members: string[];
  /** Version of the currently-returned payload (latest by default). */
  version: string;
  latestVersion: string;
  isPrivate: boolean;
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  sharedWithUsers: string[];
  sharedWithOrgs: string[];
  /** Canonical typed ACL (#1123). Present in detail responses via effectiveGrants. */
  grants?: SkillGrant[];
  createdOn: string;
  updatedOn: string;
}

/**
 * Search-result item — GET /api/v1/skillset-search.
 * Mirrors `SkillsetSearchItem`. NOTE: `memberCount` is hardcoded `0` in the
 * backend search service (a #969 follow-up — search reads the identity doc,
 * which doesn't carry the member list). Do NOT surface a member count sourced
 * from search; use the detail/closure endpoints for the real count.
 */
export interface SkillsetSearchItem {
  guid: string;
  name: string;
  description: string;
  kind: SkillsetKind;
  tags: string[];
  /** Always `0` from search (see note above). */
  memberCount: number;
  latestVersion: string;
  isPrivate: boolean;
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
  updatedOn: string;
}

/**
 * Search-response cursor metadata appended by the search route
 * (`{ ...response, meta }`). Mirrors CONVENTIONS §4.3.
 */
export interface SkillsetSearchMeta {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface SkillsetSearchResponse {
  items: SkillsetSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  meta?: SkillsetSearchMeta | undefined;
}

/** Skillset browse scope. Mirrors the backend `scope` enum. */
export type SkillsetScope =
  | "public"
  | "private"
  | "mixed"
  | "shared-with-me"
  | "mine";

/**
 * Search params — DELIBERATELY MINIMAL. Only `kind` / `tags` / `scope` /
 * `page` / `pageSize` (no semantic mode, no author facets). Mirrors the
 * backend `searchQuerySchema` knobs the web UI drives.
 */
export interface SkillsetSearchParams {
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  kind?: SkillsetKind | undefined;
  tags?: string[] | undefined;
  /** Free-text keyword — case-insensitive substring on name + description. */
  q?: string | undefined;
  scope?: SkillsetScope | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/**
 * One node in a resolved skillset closure — GET
 * /api/v1/skillsets/:idOrName/closure. The server PRE-FLATTENS the dependency
 * graph into a deps-first topo-sorted list; each node carries its BFS-style
 * `depth` (0 for roots / direct members, deeper for transitive deps). Mirrors
 * the shared `ClosureNode` shape (#968).
 */
export interface SkillsetClosureItem {
  ref: string;
  name: string;
  version: string;
  guid?: string | undefined;
  skillHash?: string | undefined;
  /** 0 for roots; max distance from any root for deeper deps. */
  depth: number;
}

/**
 * Closure result — the master prompt (`instructions`) is a ROOT sibling of
 * the flattened `items`, sourced from the same loaded version.
 */
export interface SkillsetClosureResult {
  instructions: string;
  items: SkillsetClosureItem[];
}

/** One published version row — GET /api/v1/skillsets/:idOrName/versions. */
export interface SkillsetVersionEntry {
  version: string;
  kind: SkillsetKind;
  description: string;
  instructions: string;
  tags: string[];
  members: string[];
  createdBy: string;
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
}

/** Body for POST /api/v1/skillsets (create — seeds version 1.0). */
export interface CreateSkillsetInput {
  name: string;
  description: string;
  instructions: string;
  kind: SkillsetKind;
  tags: string[];
  members: string[];
  version?: string | undefined;
}

/** Body for PUT /api/v1/skillsets/:id (publish a new immutable version). */
export interface PublishSkillsetInput {
  description?: string | undefined;
  instructions: string;
  kind?: SkillsetKind | undefined;
  tags?: string[] | undefined;
  members: string[];
  version: string;
}

/** Body for PUT /api/v1/skillsets/:id/permissions. Mirrors skills. */
export interface SkillsetPermissionsInput {
  isPrivate: boolean;
  /** Canonical typed ACL (#1123/#1125); legacy lists optional for back-compat. */
  grants?: SkillGrant[];
  sharedWithUsers?: string[];
  sharedWithOrgs?: string[];
}

/**
 * Parse a member ref into its `name@version` (or `name@tag`) parts for chip
 * display. Returns the raw ref as `name` and an empty `version` when the ref
 * carries no `@` (defensive — the backend grammar always includes one).
 */
export function parseMemberRef(ref: string): { name: string; version: string } {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref, version: "" };
  return { name: ref.slice(0, at), version: ref.slice(at + 1) };
}

/**
 * Reasons a candidate member ref is invalid in the picker. `null` = valid.
 * `nested` — `skillset:`-prefixed (no nested skillsets in v1).
 * `self` — references the skillset being edited (a set can't contain itself).
 * `empty` — blank ref.
 * `noversion` — the ref carries no version part (`name` or `name@`); the v1
 *   grammar requires `name@<version>` (or `name@<dist-tag>`).
 */
export type MemberRefRejection = "nested" | "self" | "empty" | "noversion" | null;

/**
 * Validate a candidate member ref against the v1 rules the picker enforces
 * client-side. `selfName` is the name of the skillset being edited (omit on
 * create). Returns a rejection reason or `null` when acceptable.
 */
export function rejectMemberRef(
  ref: string,
  selfName?: string,
): MemberRefRejection {
  const trimmed = ref.trim();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith(SKILLSET_REF_PREFIX)) return "nested";
  if (selfName) {
    const { name } = parseMemberRef(trimmed);
    if (name === selfName) return "self";
  }
  // Version is required: catches both a bare `name` (no `@`) and `name@`
  // (empty/whitespace version). The backend rejects these too.
  const { version } = parseMemberRef(trimmed);
  if (version.trim().length === 0) return "noversion";
  return null;
}
