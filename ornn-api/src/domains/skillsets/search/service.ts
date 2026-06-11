/**
 * Skillset search service (#969).
 *
 * Plain-Mongo discovery only — `kind` equality + `tags $all` + scope via
 * the shared `findByScope`. Deliberately NO LLM / semantic ranking and NO
 * facets: a skillset is a small curated set; discovery is by typed
 * filter, not relevance ranking (and the marketplace-drift guard rules
 * out leaderboards / popularity ranking).
 *
 * @module domains/skillsets/search/service
 */

import { createLogger } from "../../../shared/logger";
import type { SkillScope } from "../../skills/crud/scopeFilter";
import type { SkillsetRepository } from "../repository";
import type {
  SkillsetDocument,
  SkillsetKind,
  SkillsetSearchItem,
  SkillsetSearchResponse,
} from "../types";

const logger = createLogger("skillsetSearchService");

export interface SkillsetSearchServiceDeps {
  skillsetRepo: SkillsetRepository;
}

export class SkillsetSearchService {
  private readonly skillsetRepo: SkillsetRepository;

  constructor(deps: SkillsetSearchServiceDeps) {
    this.skillsetRepo = deps.skillsetRepo;
  }

  async search(params: {
    scope: SkillScope;
    currentUserId: string;
    userOrgIds: string[];
    page: number;
    pageSize: number;
    // exactOptionalPropertyTypes (#657)
    kind?: SkillsetKind | undefined;
    tagsAll?: string[] | undefined;
    q?: string | undefined;
  }): Promise<SkillsetSearchResponse> {
    const { scope, currentUserId, userOrgIds, page, pageSize } = params;
    const start = Date.now();
    const { skillsets, total } = await this.skillsetRepo.findByScope(
      scope,
      currentUserId,
      userOrgIds,
      page,
      pageSize,
      {
        kind: params.kind,
        tagsAll: params.tagsAll,
        q: params.q,
      },
    );
    logger.info(
      { scope, kind: params.kind ?? null, q: params.q ?? null, total, queryTimeMs: Date.now() - start },
      "Skillset search completed",
    );
    return {
      items: skillsets.map(toItem),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

function toItem(s: SkillsetDocument): SkillsetSearchItem {
  return {
    guid: s.guid,
    name: s.name,
    description: s.description,
    kind: s.kind,
    tags: s.tags,
    // The identity doc doesn't carry the member list (that's on the
    // version); search exposes the cached top-level shape. Member count is
    // surfaced from the detail / closure endpoints, not search — keep it 0
    // here rather than an extra per-row version read.
    memberCount: 0,
    latestVersion: s.latestVersion,
    isPrivate: s.isPrivate,
    createdBy: s.createdBy,
    createdByEmail: s.createdByEmail,
    createdByDisplayName: s.createdByDisplayName,
    createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
    updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
  };
}
