/**
 * AI domain factory.
 * Owns LLM-powered skill generation via SSE streaming.
 * Endpoint: POST /skills/generate (no /stream suffix per spec).
 * @module domains/ai
 */

import { Hono } from "hono";
import type pino from "pino";
import type { SkillConfig } from "../../config";
import type { ISkillGenerationService } from "./services/skillGenerationService";
import type { TokenVerifier } from "../../shared/types/index";

import { createSkillGenerateRoutes } from "./routes/skillGenerateRoutes";

export interface AiDomainDeps {
  config: SkillConfig;
  generationService: ISkillGenerationService;
  tokenService: TokenVerifier;
  logger: pino.Logger;
}

export interface AiDomain {
  routes: Hono;
  generationService: ISkillGenerationService;
}

export function createAiDomain(deps: AiDomainDeps): AiDomain {
  const { config, generationService, tokenService } = deps;

  // Always create routes: multi-turn path uses user's own LLM and doesn't need
  // the server-side generationService. Legacy single-prompt path still requires it.
  const routes = new Hono();
  routes.route("/", createSkillGenerateRoutes(
    generationService,
    tokenService,
    config.sseKeepAliveIntervalMs,
    config.playgroundInternalUrl,
    config.internalServiceSecret,
  ));

  return { routes, generationService };
}
