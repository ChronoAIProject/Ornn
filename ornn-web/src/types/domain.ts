import type { SkillSearchResult } from "./search";

export interface SkillSummary {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  isPrivate: boolean;
  tags: string[];
  /** Optional; present when returned from search but not always */
  updatedOn?: string;
}

export interface SkillDetail extends SkillSummary {
  updatedOn: string;
  presignedPackageUrl: string;
  metadata: Record<string, unknown>;
  isSystem?: boolean;
  /** Version of the currently-returned payload (latest by default). */
  version: string;
  /** True when the resolved version is deprecated by the author. */
  isDeprecated?: boolean;
  /** Optional note the author left when deprecating this version. */
  deprecationNote?: string | null;
  /** Person user_ids this skill has been explicitly shared with. */
  sharedWithUsers: string[];
  /** Org user_ids this skill has been explicitly shared with. */
  sharedWithOrgs: string[];
}

export interface SkillVersionEntry {
  version: string;
  skillHash: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  isDeprecated: boolean;
  deprecationNote: string | null;
}

// ---------------------------------------------------------------------------
// Topic (group of skills)
// ---------------------------------------------------------------------------

export interface Topic {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  /** Denormalized count of skills currently in this topic. */
  skillCount: number;
}

export interface TopicListPage {
  items: Topic[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Topic detail — summary + the member skills visible to the caller, sorted
 * newest-added first. Each item is the same shape as a search result so we
 * can reuse `SkillCard` / `SkillGrid` without transformation.
 */
export interface TopicDetail extends Topic {
  skills: SkillSearchResult[];
}
