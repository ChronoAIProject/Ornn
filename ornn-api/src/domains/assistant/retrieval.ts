/**
 * Visibility-scoped skill retrieval for the Ornn Assistant (#970).
 *
 * Given the caller's latest question, return up to N skills the caller is
 * allowed to see, projected down to SAFE fields only. This is the most
 * security-sensitive part of the assistant: the retrieved skills are fed
 * verbatim into the LLM context and streamed back to the user, so the
 * scoping + projection here is the data-safety boundary.
 *
 * Two independent guards (belt-and-suspenders, per the issue):
 *   1. QUERY layer — `keywordSearch(..., scope: "mixed", ...)` runs
 *      `applyScope`, which restricts the Mongo match to public skills +
 *      private skills the actor authored / was shared / is an org member
 *      of. A private skill the actor can't see never leaves the DB.
 *   2. PROJECTION layer — every surviving doc is re-checked with
 *      `canReadSkill(actor)` and then stripped to SAFE fields. Even if a
 *      future query-layer regression widened the match, the projection
 *      gate drops anything the actor can't read and never copies a
 *      PII/secret field.
 *
 * Deterministic: same (query, actor, corpus) → same result set (the repo
 * sorts by `createdOn desc`).
 *
 * @module domains/assistant/retrieval
 */

import { createLogger } from "../../shared/logger";
import type { SkillDocument } from "../../shared/types/index";
import { canReadSkill, type ActorContext } from "../skills/crud/authorize";
import type { RetrievedSkill } from "./types";

const logger = createLogger("assistantRetrieval");

/** Default top-N skills injected into the grounding. */
export const DEFAULT_MAX_RETRIEVED_SKILLS = 5;

/**
 * Cap the keyword query length. The latest user message is used verbatim
 * as the (escaped) search term; bounding it keeps the regex sane and the
 * query cheap regardless of how long the user's message is.
 */
const MAX_QUERY_CHARS = 256;

/**
 * Narrow port over the one `SkillRepository` method we use. Keeping the
 * dependency surface tiny makes the retriever trivially fakeable in tests
 * and decouples it from the full repository.
 */
export interface SkillSearchPort {
  keywordSearch(
    query: string,
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine",
    currentUserId: string,
    userOrgIds: string[],
    page: number,
    pageSize: number,
  ): Promise<{ skills: SkillDocument[]; total: number }>;
}

export interface ScopedSkillRetrieverDeps {
  readonly search: SkillSearchPort;
  readonly maxResults?: number;
}

export class ScopedSkillRetriever {
  private readonly search: SkillSearchPort;
  private readonly maxResults: number;

  constructor(deps: ScopedSkillRetrieverDeps) {
    this.search = deps.search;
    this.maxResults = deps.maxResults ?? DEFAULT_MAX_RETRIEVED_SKILLS;
  }

  /**
   * Retrieve up to `maxResults` SAFE-projected skills the actor may see,
   * matching the query. Empty / blank query → no retrieval.
   */
  async retrieve(query: string, actor: ActorContext): Promise<RetrievedSkill[]> {
    const q = query.trim().slice(0, MAX_QUERY_CHARS);
    if (q.length === 0) return [];

    const orgIds = actor.memberships.map((m) => m.userId);
    // QUERY-layer visibility: "mixed" = public + private-the-actor-can-read.
    const { skills } = await this.search.keywordSearch(
      q,
      "mixed",
      actor.userId,
      orgIds,
      1,
      this.maxResults,
    );

    // PROJECTION-layer enforcement: re-check readability, strip to SAFE
    // fields. A doc that somehow slipped past the scope filter but fails
    // `canReadSkill` is dropped and logged — it must never reach context.
    const safe: RetrievedSkill[] = [];
    for (const s of skills) {
      if (!canReadSkill(s, actor)) {
        logger.warn(
          { actor: actor.userId, skill: s.name },
          "skill passed query scope but failed canReadSkill — dropping (data-safety)",
        );
        continue;
      }
      safe.push(projectSafeSkill(s));
      if (safe.length >= this.maxResults) break;
    }
    logger.debug(
      { actor: actor.userId, matched: skills.length, returned: safe.length },
      "assistant skill retrieval complete",
    );
    return safe;
  }
}

/**
 * Strip a full skill document to the SAFE projection (#970). This is the
 * ONLY place a `SkillDocument` becomes assistant-visible — by listing
 * fields explicitly (never spreading) a newly-added sensitive field on
 * `SkillDocument` can't silently leak into the grounding.
 */
export function projectSafeSkill(s: SkillDocument): RetrievedSkill {
  const tags = Array.isArray(s.metadata?.tags) ? [...s.metadata.tags] : [];
  return {
    name: s.name,
    description: s.description,
    tags,
    category: s.metadata?.category ?? "",
    createdOn:
      s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
    createdBy: s.createdBy,
  };
}
