/**
 * Wire the skill-search domain (#580 — bootstrap decomposition).
 *
 * Search is a playground-flavoured LLM call: there's no dedicated
 * `search` section in settings, so the default model resolves through
 * the playground surface. The caller passes a `defaultModelResolver`
 * closure rather than `settingsService` directly so we don't take a
 * dependency on the whole settings surface for a single field read.
 *
 * @module domains/skills/search/bootstrap
 */

import type { Hono } from "hono";
import type { AuthVariables } from "../../../middleware/nyxidAuth";
import { SearchService } from "./service";
import { createSearchRoutes } from "./routes";
import type { SkillRepository } from "../crud/repository";
import type { NyxLlmClient } from "../../../clients/nyxid/llm";

export interface SkillSearchWiring {
  readonly service: SearchService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wireSkillSearch(deps: {
  skillRepo: SkillRepository;
  llmClient: NyxLlmClient;
  /**
   * Closure resolving the default model id at request time. Search
   * shares the playground surface today; if backend-eng-2 adds a
   * dedicated `search` section later, this stays the same — just
   * route through the new section in the caller.
   */
  defaultModelResolver: () => Promise<string>;
}): SkillSearchWiring {
  const service = new SearchService({
    skillRepo: deps.skillRepo,
    llmClient: deps.llmClient,
    defaultModelResolver: deps.defaultModelResolver,
  });
  const routes = createSearchRoutes({
    searchService: service,
    skillRepo: deps.skillRepo,
  });
  return { service, routes };
}
