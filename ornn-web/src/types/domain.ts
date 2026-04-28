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

/**
 * Origin metadata for a skill that was pulled from an external source.
 * Absent on hand-uploaded skills. `type` is a discriminator that keeps the
 * door open for GitLab / Bitbucket variants without touching callers.
 */
export type SkillSource =
  | {
      type: "github";
      /** `owner/name`. */
      repo: string;
      /** Branch, tag, or commit SHA originally requested. */
      ref: string;
      /** Subdirectory inside the repo that contains SKILL.md. Empty = repo root. */
      path: string;
      /** ISO timestamp of the most recent successful pull / refresh. */
      lastSyncedAt: string;
      /** Commit SHA fetched at `lastSyncedAt`. */
      lastSyncedCommit: string;
    };

export interface SkillDetail extends SkillSummary {
  updatedOn: string;
  presignedPackageUrl: string;
  metadata: Record<string, unknown>;
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
  /** Present when the skill was created (or last refreshed) by pulling from an external source. */
  source?: SkillSource;
  /**
   * NyxID service this skill is tied to. `null` when untied.
   * Tying to an admin (`tier: "admin"`) service marks the skill as a
   * system skill (`isSystemSkill: true`) and forces `isPrivate: false`.
   */
  nyxidServiceId?: string | null;
  /** Cached service slug for chip rendering — falls back to `nyxidServiceId` when absent. */
  nyxidServiceSlug?: string | null;
  /** Cached service label for chip rendering — falls back to slug when absent. */
  nyxidServiceLabel?: string | null;
  /** True iff tied to an admin/platform NyxID service. System skills are always public. */
  isSystemSkill?: boolean;
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
