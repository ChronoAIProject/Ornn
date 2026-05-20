/**
 * Wire the playground domain (#580 — bootstrap decomposition).
 *
 * Playground has the heaviest downstream dep list of the LLM-driven
 * domains: chat service needs the llmClient + sandboxClient +
 * skillService + surface defaults; routes additionally mount
 * analyticsService (every chat completion fires a `chat.completed`
 * event), quotaService (every call charges the playground bucket),
 * and llmProvidersService (the picker behind the SSE init event).
 *
 * @module domains/playground/bootstrap
 */

import type { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import { PlaygroundChatService } from "./chatService";
import { createPlaygroundRoutes } from "./routes";
import type { NyxLlmClient } from "../../clients/nyxid/llm";
import type { SandboxClient } from "../../clients/sandboxClient";
import type { SkillService } from "../skills/crud/service";
import type { AnalyticsService } from "../analytics/service";
import type { QuotaService } from "../quota/service";
import type { LlmProvidersService } from "../settings/llmProviders/service";

export interface PlaygroundWiring {
  readonly chatService: PlaygroundChatService;
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wirePlayground(deps: {
  llmClient: NyxLlmClient;
  sandboxClient: SandboxClient;
  skillService: SkillService;
  defaultsResolver: () => Promise<{
    model: string;
    maxOutputTokens: number;
    temperature: number;
  }>;
  keepAliveIntervalMsResolver: () => Promise<number>;
  analyticsService: AnalyticsService;
  quotaService: QuotaService;
  llmProvidersService: LlmProvidersService;
}): PlaygroundWiring {
  const chatService = new PlaygroundChatService({
    llmClient: deps.llmClient,
    sandboxClient: deps.sandboxClient,
    skillService: deps.skillService,
    defaultsResolver: deps.defaultsResolver,
  });
  const routes = createPlaygroundRoutes({
    chatService,
    keepAliveIntervalMsResolver: deps.keepAliveIntervalMsResolver,
    analyticsService: deps.analyticsService,
    skillService: deps.skillService,
    quotaService: deps.quotaService,
    llmProvidersService: deps.llmProvidersService,
  });
  return { chatService, routes };
}
