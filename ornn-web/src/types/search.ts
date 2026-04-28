/**
 * Why the current caller can see a given skill. Mirrors the backend
 * `SkillSearchItem.myAccessReason` and drives the card's access-reason
 * badge. Absent for anonymous callers (no identity → no reason).
 */
export type AccessReason = "owner" | "public" | "shared-direct" | "shared-via-org";

/** Tri-state System-skill filter. `any` shows everything; `only`
 *  restricts to skills tied to an admin/platform NyxID service
 *  (`isSystemSkill: true`); `exclude` drops those. */
export type SystemFilter = "any" | "only" | "exclude";

export type SkillScope = "public" | "private" | "mixed" | "shared-with-me" | "mine";

export interface SkillSearchParams {
  query?: string;
  mode?: "keyword" | "semantic";
  scope?: SkillScope;
  page?: number;
  pageSize?: number;
  /** System-skill tri-state; default "any". */
  systemFilter?: SystemFilter;
  /** Registry chip filters. Comma-joined client-side, parsed back on the server. */
  sharedWithOrgs?: string[];
  sharedWithUsers?: string[];
  createdByAny?: string[];
  /** Restrict to skills tied to this NyxID service (system-tab filter). */
  nyxidServiceId?: string;
  /** Skill must have ALL listed tags (AND match). */
  tags?: string[];
}

export interface SkillSearchResult {
  guid: string;
  name: string;
  description: string;
  /** Owner entity — may be a person user_id or an org user_id. */
  ownerId?: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
  /** Why the caller can see this skill; omitted for anonymous callers. */
  myAccessReason?: AccessReason;
  /** Present when myAccessReason === "shared-via-org". */
  sharedViaOrgId?: string;
  /** True when any of the skill's tags matches a slug of a NyxID service
   *  the caller can manage. */
  isSystemForMe?: boolean;
  /** The first NyxID service that matched, used to render the system chip. */
  systemForService?: { id: string; slug: string; label: string };
  /** Compact ACL view for card-level badges. */
  permissionSummary?: {
    isPrivate: boolean;
    sharedUserCount: number;
    sharedOrgCount: number;
  };
  /** NyxID service tie surfaced on cards. `null` when untied. */
  nyxidServiceId?: string | null;
  nyxidServiceSlug?: string | null;
  nyxidServiceLabel?: string | null;
  /** True iff tied to an admin/platform NyxID service. */
  isSystemSkill?: boolean;
}

export interface SkillSearchResponse {
  searchMode: string;
  searchScope: string;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  items: SkillSearchResult[];
}

export interface SkillCounts {
  public: number;
  mine: number;
  sharedWithMe: number;
}
