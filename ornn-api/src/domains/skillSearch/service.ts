/**
 * Skill search service. Supports keyword and semantic (LLM-based) modes.
 * Semantic mode loads all skills in batches and uses LLM to rank relevance
 * based on the full skill frontmatter metadata.
 * @module domains/skillSearch/service
 */

import type { SkillRepository } from "../skillCrud/repository";
import type { TopicService } from "../topics/service";
import type { NyxLlmClient } from "../../clients/nyxLlmClient";
import type { SkillDocument, SkillSearchItem, SkillSearchResponse } from "../../shared/types/index";
import type { OrgMembershipFact } from "../../middleware/nyxidAuth";
import type { UserService } from "../../clients/nyxidUserServicesClient";
import pino from "pino";

/**
 * Input params for per-item response enrichment. Passed through the
 * service methods so callers can decide how much context to fetch per
 * request. Anonymous callers pass empty arrays — the enrichment fields
 * degrade gracefully to undefined / "public".
 */
export interface SearchEnrichmentContext {
  callerUserId: string;
  callerOrgIds: string[];
  callerServices: UserService[];
}

export type SystemFilter = "any" | "only" | "exclude";

const logger = pino({ level: "info" }).child({ module: "skillSearchService" });

const BATCH_SIZE = 50;

export interface SearchServiceDeps {
  skillRepo: SkillRepository;
  /** Optional — when wired, enables the `?topic=` search filter. */
  topicService?: TopicService;
  llmClient: NyxLlmClient;
  defaultModel: string;
}

export class SearchService {
  private readonly skillRepo: SkillRepository;
  private readonly topicService?: TopicService;
  private readonly llmClient: NyxLlmClient;
  private readonly defaultModel: string;

  constructor(deps: SearchServiceDeps) {
    this.skillRepo = deps.skillRepo;
    this.topicService = deps.topicService;
    this.llmClient = deps.llmClient;
    this.defaultModel = deps.defaultModel;
  }

  async search(params: {
    query: string;
    mode: "keyword" | "semantic";
    scope: "public" | "private" | "mixed" | "shared-with-me";
    page: number;
    pageSize: number;
    currentUserId: string;
    /** Org user_ids the caller is admin or member of (viewer-role filtered out). */
    userOrgIds: string[];
    model?: string;
    /** Optional topic id-or-name; when set, restrict results to that topic's members. */
    topic?: string;
    /** True when the caller holds `ornn:admin:skill`. Only used for topic visibility. */
    isAdmin?: boolean;
    /**
     * Full NyxID org memberships for the caller (admin/member rows only).
     * Required by the topic-visibility gate so org-owned private topics are
     * reachable to their members via `?topic=`.
     */
    memberships?: OrgMembershipFact[];
    /**
     * Caller's NyxID services (personal + org-inherited). Used for
     * system-skill detection and filter: a skill whose tags include one
     * of these slugs is "system" for the caller. Pass `[]` when
     * unavailable (anonymous, or when NyxID lookup failed).
     */
    callerServices?: UserService[];
    /** Tri-state toggle for the System-skill filter. Default `any`. */
    systemFilter?: SystemFilter;
  }): Promise<SkillSearchResponse> {
    const { query, mode, scope, page, pageSize, currentUserId, userOrgIds } = params;
    const callerServices = params.callerServices ?? [];
    const systemFilter = params.systemFilter ?? "any";
    const startTime = Date.now();

    // Pre-compute the lookup set once per request. `callerServiceSlugs` is
    // the source of truth for "is this skill a system skill for me?" —
    // derived from NyxID service slugs, never from a DB field.
    const serviceSlugSet = new Set(callerServices.map((s) => s.slug));

    // When a topic filter is supplied, resolve its member GUIDs once and
    // narrow both keyword and semantic paths through it. The topic service
    // handles its own visibility (returns 404 if the caller can't see a
    // private topic).
    let restrictToGuids: string[] | undefined;
    if (params.topic) {
      if (!this.topicService) {
        // Topic filter requested but service not wired — treat as 400 rather
        // than silently ignoring so misconfigurations surface loudly.
        throw new Error("Topic filter requested but TopicService is not wired into SearchService");
      }
      restrictToGuids = await this.topicService.listMemberSkillGuids(params.topic, {
        currentUserId,
        isAdmin: params.isAdmin ?? false,
        memberships: params.memberships ?? [],
      });
    }

    let skills: SkillDocument[] = [];
    let total = 0;

    if (mode === "keyword") {
      if (!query || query.trim() === "") {
        const result = await this.skillRepo.findByScope(scope, currentUserId, userOrgIds, page, pageSize, restrictToGuids);
        skills = result.skills;
        total = result.total;
      } else {
        const result = await this.skillRepo.keywordSearch(query, scope, currentUserId, userOrgIds, page, pageSize, restrictToGuids);
        skills = result.skills;
        total = result.total;
      }
    } else if (mode === "semantic") {
      // Semantic search still runs over all skills matching scope, then
      // post-filters by the topic's member set. The LLM evaluates the same
      // metadata as before; the topic restriction is applied to the final
      // candidate list so ranking quality is preserved.
      const result = await this.semanticSearch({
        query,
        scope,
        currentUserId,
        userOrgIds,
        model: params.model ?? this.defaultModel,
        page,
        pageSize,
        restrictToGuids,
      });
      skills = result.skills;
      total = result.total;
    }

    const queryTimeMs = Date.now() - startTime;
    logger.info({ mode, scope, query: query.slice(0, 50), total, queryTimeMs }, "Search completed");

    // System-filter is applied post-query. Acceptable for V1 because
    // most users have < 20 services; pagination skew is small. Future
    // optimization: push the tag-match into the DB `$match` stage.
    const enrichedAll = skills.map((s) =>
      enrichItem(s, {
        callerUserId: currentUserId,
        callerOrgIds: userOrgIds,
        callerServices,
      }, serviceSlugSet),
    );
    const filtered = applySystemFilter(enrichedAll, systemFilter);
    const totalPages = Math.ceil(total / pageSize);

    return {
      searchMode: mode,
      searchScope: scope,
      total,
      totalPages,
      page,
      pageSize,
      items: filtered,
    };
  }

  /**
   * LLM-based semantic search. Loads all accessible skills in batches,
   * sends each batch (with full frontmatter metadata) to LLM for relevance
   * scoring, then ranks and paginates results.
   */
  private async semanticSearch(params: {
    query: string;
    scope: "public" | "private" | "mixed" | "shared-with-me";
    currentUserId: string;
    userOrgIds: string[];
    model: string;
    page: number;
    pageSize: number;
    restrictToGuids?: string[];
  }): Promise<{ skills: SkillDocument[]; total: number }> {
    const { query, scope, currentUserId, userOrgIds, model, page, pageSize, restrictToGuids } = params;

    // Load all skills matching scope (no pagination — we need all of them).
    // When a topic restriction is in effect, filter the scope result by the
    // member guid set before handing anything to the LLM.
    const allScoped = await this.skillRepo.findAllByScope(scope, currentUserId, userOrgIds);
    const allSkills = restrictToGuids
      ? allScoped.filter((s) => restrictToGuids.includes(s.guid))
      : allScoped;

    if (allSkills.length === 0) {
      return { skills: [], total: 0 };
    }

    logger.info({ totalSkills: allSkills.length, query: query.slice(0, 50) }, "Semantic search: evaluating skills");

    // Process in batches, collect candidate GUIDs with relevance scores
    const candidates: Array<{ guid: string; score: number; reason: string }> = [];

    for (let i = 0; i < allSkills.length; i += BATCH_SIZE) {
      const batch = allSkills.slice(i, i + BATCH_SIZE);
      const batchResults = await this.evaluateBatch(batch, query, model);
      candidates.push(...batchResults);
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Filter: only include skills with score > 0
    const matched = candidates.filter((c) => c.score > 0);
    const total = matched.length;

    // Paginate
    const offset = (page - 1) * pageSize;
    const pageGuids = matched.slice(offset, offset + pageSize).map((c) => c.guid);

    // Preserve LLM ranking order
    const guidOrder = new Map(pageGuids.map((g, idx) => [g, idx]));
    const skills = allSkills
      .filter((s) => guidOrder.has(s.guid))
      .sort((a, b) => (guidOrder.get(a.guid) ?? 999) - (guidOrder.get(b.guid) ?? 999));

    logger.debug({ matched: total, returned: skills.length }, "Semantic search results");

    return { skills, total };
  }

  /**
   * Build a compact representation of a skill's full frontmatter metadata
   * for LLM evaluation.
   */
  private buildSkillSummary(skill: SkillDocument): Record<string, unknown> {
    const summary: Record<string, unknown> = {
      id: skill.guid,
      name: skill.name,
      description: skill.description,
      category: skill.metadata?.category ?? "unknown",
    };

    if (skill.metadata?.tags?.length) {
      summary.tags = skill.metadata.tags;
    }

    if (skill.metadata?.outputType) {
      summary.outputType = skill.metadata.outputType;
    }

    if (skill.metadata?.runtimes?.length) {
      summary.runtimes = skill.metadata.runtimes.map((r) => {
        const entry: Record<string, unknown> = { runtime: r.runtime };
        if (r.dependencies?.length) {
          entry.dependencies = r.dependencies.map((d) => `${d.library}@${d.version}`);
        }
        if (r.envs?.length) {
          entry.envVars = r.envs.map((e) => e.var);
        }
        return entry;
      });
    }

    if (skill.metadata?.tools?.length) {
      summary.tools = skill.metadata.tools.map((t) => {
        const entry: Record<string, unknown> = { tool: t.tool, type: t.type };
        if (t["mcp-servers"]?.length) {
          entry.mcpServers = t["mcp-servers"].map((m) => m.mcp);
        }
        return entry;
      });
    }

    if (skill.license) {
      summary.license = skill.license;
    }

    if (skill.compatibility) {
      summary.compatibility = skill.compatibility;
    }

    return summary;
  }

  /**
   * Send a batch of skills to LLM for relevance evaluation.
   * Includes full frontmatter metadata for each skill.
   * Returns scored candidates from this batch.
   */
  private async evaluateBatch(
    batch: SkillDocument[],
    query: string,
    model: string,
  ): Promise<Array<{ guid: string; score: number; reason: string }>> {
    const skillList = batch.map((s) => this.buildSkillSummary(s));

    const prompt = `You are a skill search engine. Given a user query and a list of skills with their full metadata, evaluate each skill's relevance to the query.

Consider ALL metadata fields when scoring: name, description, category, tags, output type, runtimes, dependencies, environment variables, tools, MCP servers, license, and compatibility.

For each skill, assign a relevance score from 0 to 10:
- 0: completely irrelevant
- 1-3: loosely related
- 4-6: somewhat relevant
- 7-9: highly relevant
- 10: exact match

Return ONLY a JSON array of objects with the fields: id, score, reason (brief explanation).
Only include skills with score > 0. If no skills are relevant, return an empty array [].

User query: "${query}"

Skills:
${JSON.stringify(skillList, null, 2)}`;

    try {
      const outputs = await this.llmClient.complete({
        model,
        input: [{ role: "user", content: prompt }],
        instructions: "You are a precise skill search ranking engine. Output only valid JSON. No markdown, no code blocks, just the JSON array.",
        max_output_tokens: 4096,
        temperature: 0.1,
      });

      // Extract text from Responses API output
      let text = "";
      for (const output of outputs) {
        if (output.type === "message" && output.content) {
          for (const part of output.content) {
            if (part.text) text += part.text;
          }
        }
      }
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        logger.warn({ batchSize: batch.length }, "Semantic search: LLM returned no parseable JSON");
        return [];
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{ id: string; score: number; reason?: string }>;

      // Validate and map
      const validGuids = new Set(batch.map((s) => s.guid));
      return parsed
        .filter((r) => validGuids.has(r.id) && typeof r.score === "number" && r.score > 0)
        .map((r) => ({
          guid: r.id,
          score: Math.min(10, Math.max(0, r.score)),
          reason: r.reason ?? "",
        }));
    } catch (err) {
      logger.error({ err, batchSize: batch.length }, "Semantic search: LLM evaluation failed for batch");
      return [];
    }
  }
}

/**
 * Compute the per-caller enrichment fields on a skill doc:
 * `myAccessReason`, `isSystemForMe`, `systemForService`, and the
 * `permissionSummary` card badges rely on. Values are derived purely
 * from the caller's identity + services + the skill itself; no extra
 * queries.
 *
 * Ordering of `myAccessReason`:
 *   - `owner`          — caller authored it; wins over everything else.
 *   - `public`         — visible to everyone; derived when `!isPrivate`.
 *   - `shared-direct`  — private, caller listed in `sharedWithUsers`.
 *   - `shared-via-org` — private, one of caller's orgs in `sharedWithOrgs`.
 */
function enrichItem(
  s: SkillDocument,
  ctx: { callerUserId: string; callerOrgIds: string[]; callerServices: UserService[] },
  serviceSlugSet: Set<string>,
): SkillSearchItem {
  const tags = s.metadata?.tags ?? [];

  let myAccessReason: SkillSearchItem["myAccessReason"];
  let sharedViaOrgId: string | undefined;
  if (ctx.callerUserId && s.createdBy === ctx.callerUserId) {
    myAccessReason = "owner";
  } else if (!s.isPrivate) {
    myAccessReason = "public";
  } else if (ctx.callerUserId && s.sharedWithUsers.includes(ctx.callerUserId)) {
    myAccessReason = "shared-direct";
  } else {
    const matchedOrg = s.sharedWithOrgs.find((id) => ctx.callerOrgIds.includes(id));
    if (matchedOrg) {
      myAccessReason = "shared-via-org";
      sharedViaOrgId = matchedOrg;
    }
  }

  const systemTag = tags.find((t) => serviceSlugSet.has(t));
  const isSystemForMe = systemTag !== undefined;
  const systemForService = systemTag
    ? ctx.callerServices.find((svc) => svc.slug === systemTag)
    : undefined;

  return {
    guid: s.guid,
    name: s.name,
    description: s.description,
    ownerId: s.ownerId,
    createdBy: s.createdBy,
    createdByEmail: s.createdByEmail,
    createdByDisplayName: s.createdByDisplayName,
    createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
    updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
    isPrivate: s.isPrivate,
    tags,
    myAccessReason,
    sharedViaOrgId,
    isSystemForMe,
    systemForService: systemForService
      ? { id: systemForService.id, slug: systemForService.slug, label: systemForService.label }
      : undefined,
    permissionSummary: {
      isPrivate: s.isPrivate,
      sharedUserCount: s.sharedWithUsers.length,
      sharedOrgCount: s.sharedWithOrgs.length,
    },
  };
}

/**
 * Post-query `systemFilter` toggle. Applied client-side in the service
 * because the detection depends on the caller's service list (not a DB
 * field). Skew against pagination totals is accepted for V1.
 */
function applySystemFilter(items: SkillSearchItem[], filter: SystemFilter): SkillSearchItem[] {
  if (filter === "any") return items;
  if (filter === "only") return items.filter((i) => i.isSystemForMe);
  return items.filter((i) => !i.isSystemForMe);
}
