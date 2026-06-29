/**
 * Skillset search service (#969, reworked for #1136).
 *
 * Plain-Mongo discovery — `kind` equality + `tags $all` + scope. No LLM /
 * semantic ranking and no facets: a skillset is a small curated set;
 * discovery is by typed filter (the marketplace-drift guard rules out
 * leaderboards / popularity ranking).
 *
 * Visibility is DERIVED from members (#1136), not owner-set. Two paths:
 *   - `public` / `mine` → exact Mongo pagination on denormalized fields
 *     (the all-public fast-path; the common browse case stays O(1)).
 *   - `private` / `mixed` / `shared-with-me` → a bounded candidate fetch,
 *     then a LIVE per-caller member-readability check (Option B) on the
 *     restricted candidates, then in-memory pagination. A restricted
 *     skillset is discoverable only by callers who can read all its
 *     members; never leaked otherwise.
 *
 * @module domains/skillsets/search/service
 */

import { createLogger } from "../../../shared/logger";
import type { ActorContext } from "../../skills/crud/authorize";
import type { SkillScope } from "../../skills/crud/scopeFilter";
import type { SkillsetRepository } from "../repository";
import type { SkillsetService } from "../service";
import type {
  SkillsetDocument,
  SkillsetKind,
  SkillsetSearchItem,
  SkillsetSearchResponse,
} from "../types";

const logger = createLogger("skillsetSearchService");

/**
 * Ceiling on the candidate set a live-scope query live-filters per request
 * (#1136). Skillsets are a small curated registry, so this is generous; if
 * it is ever hit the service logs a warning (no silent truncation). Mirrors
 * the repository's `MAX_QUERY_MS` precedent of an internal safety constant.
 */
const LIVE_SCOPE_CANDIDATE_CAP = 500;

export interface SkillsetSearchServiceDeps {
  skillsetRepo: SkillsetRepository;
  /** #1136 — live member-readability check for restricted-candidate filtering. */
  skillsetService: SkillsetService;
}

export class SkillsetSearchService {
  private readonly skillsetRepo: SkillsetRepository;
  private readonly skillsetService: SkillsetService;

  constructor(deps: SkillsetSearchServiceDeps) {
    this.skillsetRepo = deps.skillsetRepo;
    this.skillsetService = deps.skillsetService;
  }

  async search(params: {
    scope: SkillScope;
    /** Resolved caller (#1136) — userId + org memberships drive the live gate. */
    actor: ActorContext;
    page: number;
    pageSize: number;
    // exactOptionalPropertyTypes (#657)
    kind?: SkillsetKind | undefined;
    tagsAll?: string[] | undefined;
    q?: string | undefined;
  }): Promise<SkillsetSearchResponse> {
    const { scope, actor, page, pageSize } = params;
    const caller = actor.userId;
    const filters = { kind: params.kind, tagsAll: params.tagsAll, q: params.q };
    const start = Date.now();

    let skillsets: SkillsetDocument[];
    let total: number;

    if (scope === "public" || scope === "mine") {
      // Fast-path: denormalized-only, exact Mongo pagination.
      ({ skillsets, total } = await this.skillsetRepo.findCheapScope(
        scope,
        caller,
        page,
        pageSize,
        filters,
      ));
    } else {
      // Live-scope path: candidate fetch → per-caller member check → page.
      const { candidates, capped } = await this.skillsetRepo.findLiveScopeCandidates(
        scope,
        caller,
        filters,
        LIVE_SCOPE_CANDIDATE_CAP,
      );
      if (capped) {
        logger.warn(
          { scope, cap: LIVE_SCOPE_CANDIDATE_CAP },
          "Skillset discovery candidate set hit the cap; some restricted skillsets may be omitted from later pages",
        );
      }
      const visible = await this.filterDiscoverable(candidates, caller, actor);
      total = visible.length;
      const offset = (page - 1) * pageSize;
      skillsets = visible.slice(offset, offset + pageSize);
    }

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

  /**
   * Keep only the candidates the actor may discover (#1136). The caller's
   * own skillsets and plainly-public ones pass without a member check; every
   * other (restricted-by-others) candidate is live-checked against the
   * actor. Preserves candidate order (already newest-first).
   */
  private async filterDiscoverable(
    candidates: SkillsetDocument[],
    caller: string,
    actor: ActorContext,
  ): Promise<SkillsetDocument[]> {
    const visible: SkillsetDocument[] = [];
    for (const candidate of candidates) {
      if (
        (caller && candidate.createdBy === caller) ||
        candidate.memberVisibilityState === "all-public"
      ) {
        // Owner's own (any state — theirs to see) or plainly public (mixed).
        visible.push(candidate);
        continue;
      }
      if (await this.skillsetService.canDiscoverSkillset(candidate, actor)) {
        visible.push(candidate);
      }
    }
    return visible;
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
    // Derived visibility (#1136) — drives the badge in browse/search lists.
    memberVisibilityState: s.memberVisibilityState ?? "all-public",
    createdBy: s.createdBy,
    createdByEmail: s.createdByEmail,
    createdByDisplayName: s.createdByDisplayName,
    createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
    updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
  };
}
