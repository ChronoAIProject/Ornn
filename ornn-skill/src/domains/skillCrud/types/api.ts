/** Standard API response wrapper. */
export interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
}

/** Skill detail returned by skill-read and skill-update endpoints. */
export interface SkillDetailResponse {
  guid: string;
  name: string;
  description: string;
  license: string | null;
  compatibility: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  skillHash: string;
  presignedPackageUrl: string;
  isPrivate: boolean;
  createdBy: string;
  createdOn: string;
  updatedOn: string;
}

/** Skill item in search results. */
export interface SkillSearchItem {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
}

/** Search response envelope. */
export interface SkillSearchResponse {
  searchMode: string;
  searchScope: string;
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  items: SkillSearchItem[];
}
