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
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  query?: string | undefined;
  mode?: "keyword" | "semantic" | undefined;
  scope?: SkillScope | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  systemFilter?: SystemFilter | undefined;
  sharedWithOrgs?: string[] | undefined;
  sharedWithUsers?: string[] | undefined;
  createdByAny?: string[] | undefined;
  nyxidServiceId?: string | undefined;
  tags?: string[] | undefined;
}

export interface SkillSearchResult {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  // Optionals widen to `T | undefined` for exactOptionalPropertyTypes (#657).
  createdByEmail?: string | undefined;
  createdByDisplayName?: string | undefined;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
  myAccessReason?: AccessReason | undefined;
  sharedViaOrgId?: string | undefined;
  isSystemForMe?: boolean | undefined;
  systemForService?: { id: string; slug: string; label: string } | undefined;
  permissionSummary?:
    | {
        isPrivate: boolean;
        sharedUserCount: number;
        sharedOrgCount: number;
      }
    | undefined;
  /** NyxID service tie surfaced on cards. `null` when untied. */
  nyxidServiceId?: string | null | undefined;
  nyxidServiceSlug?: string | null | undefined;
  nyxidServiceLabel?: string | null | undefined;
  /** True iff tied to an admin/platform NyxID service. */
  isSystemSkill?: boolean | undefined;
  hasGithubSource?: boolean | undefined;
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
