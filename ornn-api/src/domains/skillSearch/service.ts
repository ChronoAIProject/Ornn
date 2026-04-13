/**
 * Skill search service. Supports keyword and semantic (LLM-based) modes.
 * Semantic mode loads all skills in batches and uses LLM to rank relevance
 * based on the full skill frontmatter metadata.
 * @module domains/skillSearch/service
 */

import type { SkillRepository } from "../skillCrud/repository";
import type { NyxLlmClient } from "../../clients/nyxLlmClient";
import type { SkillDocument, SkillSearchItem, SkillSearchResponse } from "../../shared/types/index";
import pino from "pino";

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
    scope: "public" | "private" | "mixed";
    page: number;
    pageSize: number;
    currentUserId: string;
    model?: string;
  }): Promise<SkillSearchResponse> {
    const { query, mode, scope, page, pageSize, currentUserId } = params;
    const startTime = Date.now();

    let skills: SkillDocument[] = [];
    let total = 0;

    if (mode === "keyword") {
      if (!query || query.trim() === "") {
        const result = await this.skillRepo.findByScope(scope, currentUserId, page, pageSize);
        skills = result.skills;
        total = result.total;
      } else {
        const result = await this.skillRepo.keywordSearch(query, scope, currentUserId, page, pageSize);
        skills = result.skills;
        total = result.total;
      }
    } else if (mode === "semantic") {
      const result = await this.semanticSearch({
        query,
        scope,
        currentUserId,
        model: params.model ?? this.defaultModel,
        page,
        pageSize,
      });
      skills = result.skills;
      total = result.total;
    }

    const queryTimeMs = Date.now() - startTime;
    logger.info({ mode, scope, query: query.slice(0, 50), total, queryTimeMs }, "Search completed");

    const totalPages = Math.ceil(total / pageSize);

    const items: SkillSearchItem[] = skills.map((s) => ({
      guid: s.guid,
      name: s.name,
      description: s.description,
      createdBy: s.createdBy,
      createdByEmail: s.createdByEmail,
      createdByDisplayName: s.createdByDisplayName,
      createdOn: s.createdOn instanceof Date ? s.createdOn.toISOString() : String(s.createdOn),
      updatedOn: s.updatedOn instanceof Date ? s.updatedOn.toISOString() : String(s.updatedOn),
      isPrivate: s.isPrivate,
      tags: s.metadata?.tags ?? [],
    }));

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
    scope: "public" | "private" | "mixed";
    currentUserId: string;
    model: string;
    page: number;
    pageSize: number;
  }): Promise<{ skills: SkillDocument[]; total: number }> {
    const { query, scope, currentUserId, model, page, pageSize } = params;

    // Load all skills matching scope (no pagination — we need all of them)
    const allSkills = await this.skillRepo.findAllByScope(scope, currentUserId);

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
