/**
 * Skill search service. Supports keyword and semantic (LLM-based) modes.
 * Semantic mode loads all skills in batches and uses LLM to rank relevance
 * based on the full skill frontmatter metadata.
 * @module domains/skills/search/service
 */

import type { SkillRepository } from "../crud/repository";
import type { NyxLlmClient } from "../../../clients/nyxid/llm";
import type { SkillDocument, SkillSearchItem, SkillSearchResponse } from "../../../shared/types/index";
import pino from "pino";

/**
 * Per-item response enrichment context. The system-skill predicate is
 * now read off `SkillDocument.isSystemSkill` (cached at tie-time) — no
 * caller-services slug match. Kept as an interface for future
 * caller-scoped fields.
 */
export interface SearchEnrichmentContext {
  callerUserId: string;
  callerOrgIds: string[];
}

export type SystemFilter = "any" | "only" | "exclude";

const logger = pino({ level: "info" }).child({ module: "skillSearchService" });

const BATCH_SIZE = 50;

export interface SearchServiceDeps {
  skillRepo: SkillRepository;
  llmClient: NyxLlmClient;
  defaultModel: string;
}

export class SearchService {
  private readonly skillRepo: SkillRepository;
  private readonly llmClient: NyxLlmClient;
  private readonly defaultModel: string;

  constructor(deps: SearchServiceDeps) {
    this.skillRepo = deps.skillRepo;
    this.llmClient = deps.llmClient;
    this.defaultModel = deps.defaultModel;
  }

  async search(params: {
    query: string;
    mode: "keyword" | "semantic";
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine";
    page: number;
    pageSize: number;
    currentUserId: string;
    /** Org user_ids the caller is admin or member of (viewer-role filtered out). */
    userOrgIds: string[];
    model?: string;
    /**
     * Tri-state toggle for the System-skill filter. Pushed down to the
     * DB match stage — `isSystemSkill: true` (cached on the skill doc
     * at tie-time) is the source of truth.
     */
    systemFilter?: SystemFilter;
    /** Registry filter-chip constraints. Applied at the DB match level. */
    sharedWithOrgsAny?: string[];
    sharedWithUsersAny?: string[];
    createdByAny?: string[];
    /** Restrict to skills tied to a specific NyxID service. */
    nyxidServiceId?: string;
    /** Skills must have ALL listed tags (AND match). */
    tagsAll?: string[];
  }): Promise<SkillSearchResponse> {
    const { query, mode, scope, page, pageSize, currentUserId, userOrgIds } = params;
    const systemFilter = params.systemFilter ?? "any";
    const startTime = Date.now();

    let skills: SkillDocument[] = [];
    let total = 0;

    const extraFilters = {
      sharedWithOrgsAny: params.sharedWithOrgsAny,
      sharedWithUsersAny: params.sharedWithUsersAny,
      createdByAny: params.createdByAny,
      systemFilter,
      nyxidServiceId: params.nyxidServiceId,
      tagsAll: params.tagsAll,
    };

    if (mode === "keyword") {
      if (!query || query.trim() === "") {
        const result = await this.skillRepo.findByScope(scope, currentUserId, userOrgIds, page, pageSize, undefined, extraFilters);
        skills = result.skills;
        total = result.total;
      } else {
        const result = await this.skillRepo.keywordSearch(query, scope, currentUserId, userOrgIds, page, pageSize, undefined, extraFilters);
        skills = result.skills;
        total = result.total;
      }
    } else if (mode === "semantic") {
      // Semantic search runs over all skills matching scope and uses the
      // LLM to rank by full frontmatter metadata. Extra filters
      // (system/tag/service) are applied post-DB-fetch but pre-LLM so we
      // don't waste tokens ranking skills the user filtered out.
      const result = await this.semanticSearch({
        query,
        scope,
        currentUserId,
        userOrgIds,
        model: params.model ?? this.defaultModel,
        page,
        pageSize,
        systemFilter,
        nyxidServiceId: params.nyxidServiceId,
        tagsAll: params.tagsAll,
      });
      skills = result.skills;
      total = result.total;
    }

    const queryTimeMs = Date.now() - startTime;
    logger.info({ mode, scope, query: query.slice(0, 50), total, queryTimeMs }, "Search completed");

    const items = skills.map((s) =>
      enrichItem(s, { callerUserId: currentUserId, callerOrgIds: userOrgIds }),
    );
    const totalPages = Math.ceil(total / pageSize);

    return {
      searchMode: mode,
      searchScope: scope,
      total,
      totalPages,
      page,
      pageSize,
      items,
    };
  }

  /**
   * LLM-based semantic search. Loads all accessible skills in batches,
   * sends each batch (with full frontmatter metadata) to LLM for relevance
   * scoring, then ranks and paginates results.
   */
  private async semanticSearch(params: {
    query: string;
    scope: "public" | "private" | "mixed" | "shared-with-me" | "mine";
    currentUserId: string;
    userOrgIds: string[];
    model: string;
    page: number;
    pageSize: number;
    systemFilter: SystemFilter;
    nyxidServiceId?: string;
    tagsAll?: string[];
  }): Promise<{ skills: SkillDocument[]; total: number }> {
    const { query, scope, currentUserId, userOrgIds, model, page, pageSize, systemFilter, nyxidServiceId, tagsAll } = params;

    // Load all skills matching scope (no pagination — we need all of them).
    const allRaw = await this.skillRepo.findAllByScope(scope, currentUserId, userOrgIds);
    // Filter the candidate pool *before* paying the LLM round-trip cost.
    const allSkills = allRaw
      .filter((s) =>
        systemFilter === "only"
          ? s.isSystemSkill === true
          : systemFilter === "exclude"
            ? s.isSystemSkill !== true
            : true,
      )
      .filter((s) => !nyxidServiceId || s.nyxidServiceId === nyxidServiceId)
      .filter((s) => {
        if (!tagsAll || tagsAll.length === 0) return true;
        const docTags = new Set(s.metadata?.tags ?? []);
        return tagsAll.every((t) => docTags.has(t));
      });

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
  ctx: { callerUserId: string; callerOrgIds: string[] },
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

  // System-skill predicate now reads straight off the cached doc field.
  // `isSystemForMe` retained as a name for back-compat — semantically it
  // is now "this is a platform system skill" (true for everyone) since
  // admin-tier ties force the skill public.
  const isSystemForMe = s.isSystemSkill === true;
  const systemForService =
    isSystemForMe && s.nyxidServiceId
      ? {
          id: s.nyxidServiceId,
          slug: s.nyxidServiceSlug ?? "",
          label: s.nyxidServiceLabel ?? s.nyxidServiceSlug ?? "",
        }
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
    systemForService,
    permissionSummary: {
      isPrivate: s.isPrivate,
      sharedUserCount: s.sharedWithUsers.length,
      sharedOrgCount: s.sharedWithOrgs.length,
    },
    nyxidServiceId: s.nyxidServiceId ?? null,
    nyxidServiceSlug: s.nyxidServiceSlug ?? null,
    nyxidServiceLabel: s.nyxidServiceLabel ?? null,
    isSystemSkill: s.isSystemSkill === true,
    // Boolean — true when the skill is linked to a GitHub source. The
    // card uses this to render a small non-clickable GitHub mark in the
    // badge row. We don't leak the actual repo URL to search results;
    // the user can drill into the detail page for that.
    hasGithubSource: !!(s.source && s.source.type === "github"),
  };
}
