/**
 * Wire the Ornn Assistant domain (#970).
 *
 * Composition root: build the KB loader (cache warmed at boot), the
 * visibility-scoped skill retriever (over the shared `SkillRepository`),
 * the chat service, and mount the SSE route. Quota + model resolution +
 * SSE keep-alive are injected as resolvers so admin settings edits land on
 * the next request without a restart.
 *
 * @module domains/assistant/bootstrap
 */

import type { Hono } from "hono";
import type { AuthVariables } from "../../middleware/nyxidAuth";
import type { NyxLlmClient } from "../../clients/nyxid/llm";
import type { SkillRepository } from "../skills/crud/repository";
import type { QuotaService } from "../quota/service";
import type { LlmProvidersService } from "../settings/llmProviders/service";
import { AssistantKbLoader } from "./kb/loader";
import { ScopedSkillRetriever, type SkillSearchPort } from "./retrieval";
import {
  AssistantChatService,
  type AssistantChatDefaults,
} from "./chatService";
import { createAssistantRoutes } from "./routes";

export interface AssistantWiring {
  readonly routes: Hono<{ Variables: AuthVariables }>;
}

export function wireAssistant(deps: {
  llmClient: NyxLlmClient;
  skillRepo: SkillRepository;
  quotaService: QuotaService;
  llmProvidersService: LlmProvidersService;
  /** Resolve the per-request model + sampling snapshot (assistant surface). */
  defaultsResolver: () => Promise<AssistantChatDefaults>;
  /** Resolve the SSE keep-alive cadence (assistant section). */
  keepAliveIntervalMsResolver: () => Promise<number>;
  /** Optional KB loader override (tests inject a fake digest reader). */
  kbLoader?: AssistantKbLoader;
}): AssistantWiring {
  const kbLoader = deps.kbLoader ?? new AssistantKbLoader();
  // Warm the cache at boot so the first chat doesn't pay the artifact read
  // (and any read/budget warning surfaces in boot logs, not mid-stream).
  kbLoader.load();

  const retriever = new ScopedSkillRetriever({
    // SkillRepository structurally satisfies the narrow SkillSearchPort.
    search: deps.skillRepo as SkillSearchPort,
  });

  const chatService = new AssistantChatService({
    llmClient: deps.llmClient,
    kbLoader,
    retriever,
    defaultsResolver: deps.defaultsResolver,
  });

  const routes = createAssistantRoutes({
    chatService,
    quotaService: deps.quotaService,
    llmProvidersService: deps.llmProvidersService,
    keepAliveIntervalMsResolver: deps.keepAliveIntervalMsResolver,
  });

  return { routes };
}
