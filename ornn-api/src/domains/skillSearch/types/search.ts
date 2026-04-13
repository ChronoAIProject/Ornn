/**
 * Search types for the unified skill-search endpoint.
 * @module types/search
 */

/** Parameters for the unified search endpoint. */
export interface UnifiedSearchParams {
  query: string;
  mode: "keyword" | "semantic";
  scope: "public" | "private" | "mixed";
  page: number;
  pageSize: number;
}
