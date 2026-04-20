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
