/**
 * Interface definitions for skill repository operations.
 * Aligned with design spec: uses guid, name, description, license,
 * compatibility, metadata (nested), skillHash, s3Url, createdBy,
 * createdOn, updatedBy, updatedOn, isPrivate.
 * @module repositories/skillRepository.interface
 */

/** The MongoDB document shape for a skill, matching the design spec. */
export interface SkillDocument {
  guid: string;
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: SkillMetadata;
  skillHash: string;
  s3Url: string;
  createdBy: string;
  createdOn: Date;
  updatedBy: string;
  updatedOn: Date;
  isPrivate: boolean;
}

/** Nested metadata object per spec. */
export interface SkillMetadata {
  category: string;
  runtimes?: Array<{
    runtime: string;
    dependencies?: Array<{ library: string; version: string }>;
    envs?: Array<{ var: string; description: string }>;
  }>;
  tools?: Array<{
    tool: string;
    type: string;
    "mcp-servers"?: Array<{ mcp: string; version: string }>;
  }>;
  tags?: string[];
}

export interface CreateSkillData {
  guid: string;
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata: SkillMetadata;
  skillHash: string;
  s3Url: string;
  createdBy: string;
  isPrivate?: boolean;
}

export interface UpdateSkillData {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: SkillMetadata;
  skillHash?: string;
  s3Url?: string;
  isPrivate?: boolean;
  updatedBy: string;
}

export interface SkillFilters {
  /** Text query for keyword search (GUID exact match or name/description contains). */
  q?: string;
  /** Filter by scope: public, private (by ownerId), or mixed. */
  scope?: "public" | "private" | "mixed";
  /** The current user ID (needed for private/mixed scope). */
  currentUserId?: string;
  page: number;
  pageSize: number;
}

export interface ISkillRepository {
  findByGuid(guid: string): Promise<SkillDocument | null>;
  findByName(name: string): Promise<SkillDocument | null>;
  findAll(filters: SkillFilters): Promise<{ skills: SkillDocument[]; total: number }>;
  create(data: CreateSkillData): Promise<SkillDocument>;
  update(guid: string, data: UpdateSkillData): Promise<SkillDocument>;
  hardDelete(guid: string): Promise<void>;

  /**
   * Keyword search: exact GUID match + name/description contains.
   * Filters by scope.
   */
  keywordSearch(
    query: string,
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }>;

  /**
   * Scope-filtered find for paginated listing (empty query = all in scope).
   */
  findByScope(
    scope: "public" | "private" | "mixed",
    currentUserId: string,
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }>;

  /**
   * Find skills by a list of GUIDs (used for similarity search post-filter).
   */
  findByGuids(guids: string[]): Promise<SkillDocument[]>;
}
