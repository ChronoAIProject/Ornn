export interface SkillSearchParams {
  query?: string;
  mode?: "keyword" | "semantic";
  scope?: "public" | "private" | "mixed";
  page?: number;
  pageSize?: number;
  /** Optional topic id-or-name — restricts results to that topic's members. */
  topic?: string;
}

export interface SkillSearchResult {
  guid: string;
  name: string;
  description: string;
  createdBy: string;
  createdByEmail?: string;
  createdByDisplayName?: string;
  createdOn: string;
  updatedOn: string;
  isPrivate: boolean;
  tags: string[];
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
