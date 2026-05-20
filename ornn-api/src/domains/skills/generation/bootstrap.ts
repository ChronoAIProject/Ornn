/**
 * Wire the skill-generation domain (#580 — bootstrap decomposition).
 *
 * Generation has more downstream coupling than search — it owns its
 * own surface (`skillGen`) in settings, so the keep-alive interval
 * + default model both resolve through settingsService. It also
 * mounts QuotaService (every generation charges the user's
 * skill-gen bucket) and LlmProvidersService (the picker behind the
 * SSE init event).
 *
 * @module domains/skills/generation/bootstrap
 */

import type { Hono } from "hono";
import type { AuthVariables } from "../../../middleware/nyxidAuth";
import { SkillGenerationService } from "./service";
import { createGenerationRoutes } from "./routes";
import type { NyxLlmClient } from "../../../clients/nyxid/llm";
import type { QuotaService } from "../../quota/service";
import type { LlmProvidersService } from "../../settings/llmProviders/service";

export interface SkillGenerationWiring {
  readonly service: SkillGenerationService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wireSkillGeneration(deps: {
  llmClient: NyxLlmClient;
  /** Returns `{ model, maxOutputTokens, temperature }` snapshot for the skillGen surface. */
  defaultsResolver: () => Promise<{
    model: string;
    maxOutputTokens: number;
    temperature: number;
  }>;
  /** Per-request SSE keepalive interval (ms) — driven by `skillGen.sseKeepAliveMs`. */
  keepAliveIntervalMsResolver: () => Promise<number>;
  quotaService: QuotaService;
  llmProvidersService: LlmProvidersService;
}): SkillGenerationWiring {
  const service = new SkillGenerationService({
    llmClient: deps.llmClient,
    defaultsResolver: deps.defaultsResolver,
  });
  const routes = createGenerationRoutes({
    generationService: service,
    keepAliveIntervalMsResolver: deps.keepAliveIntervalMsResolver,
    quotaService: deps.quotaService,
    llmProvidersService: deps.llmProvidersService,
  });
  return { service, routes };
}
