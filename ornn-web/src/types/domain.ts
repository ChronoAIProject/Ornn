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
}
