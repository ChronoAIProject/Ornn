/**
 * Skill generation routes with NyxID auth.
 * POST /api/skills/generate — SSE streaming skill generation via Nyx Provider.
 * @module domains/skills/generation/routes
 */

import { Hono } from "hono";
import type { SkillGenerationService } from "./service";
import type { QuotaService } from "../../quota/service";
import type { LlmProvidersService } from "../../settings/llmProviders/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { rateLimit } from "../../../middleware/rateLimit";
import { fetchGithubSourceBundle } from "./githubFetcher";
import { analyzePackageContent } from "./packageContext";
import { preflight, resolveKeepAliveMs, streamGenerationEvents } from "./streaming";
import { createLogger } from "../../../shared/logger";
import { z } from "zod";

const logger = createLogger("skillGenerationRoutes");

/**
 * Per-message + per-prompt content cap (#654). Mirrors the playground
 * chat schema's `MAX_CHAT_MESSAGE_CHARS` and the frontend
 * `MAX_INPUT_CHARS` in `ChatInput.tsx`. Keep all three in sync.
 */
const MAX_GENERATION_CHARS = 32_000;

export interface GenerationRoutesConfig {
  generationService: SkillGenerationService;
  /**
   * SSE keep-alive interval (ms). Resolved from admin settings
   * (`skillGen.sseKeepAliveMs`) on every request so an admin's edit
   * lands without a redeploy. Internal helpers still take a number
   * — the route handler resolves once per request and threads it down.
   */
  keepAliveIntervalMsResolver: () => Promise<number>;
  /** Per-user quota gate (charged on completion). */
  quotaService: QuotaService;
  /** Admin-curated model catalog (per-provider, #270). */
  llmProvidersService: LlmProvidersService;
}

export function createGenerationRoutes(config: GenerationRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { generationService, keepAliveIntervalMsResolver, quotaService, llmProvidersService } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  /**
   * POST /skills/generate
   * Input: multipart (prompt + optional package ZIP) or JSON (prompt or messages, optional modelId)
   * Response: SSE stream of generation events
   * Requires: ornn:skill:build
   */
  app.post(
    "/skills/generate",
    auth,
    requirePermission("ornn:skill:build"),
    // Rate limit (#439): every generation runs an LLM call —
    // most expensive endpoint in the API. Per-user 20/min is
    // ~3s minimum between requests, which still feels instant for
    // legitimate flows while stopping a script from burning budget.
    rateLimit({ windowMs: 60_000, max: 20, label: "skills-generate" }),
    async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      const authCtx = getAuth(c);
      let prompt: string;
      let packageContent: string | null = null;
      let requestedModelId: string | undefined;

      if (contentType.includes("multipart/form-data")) {
        const body = await c.req.parseBody({ all: true });

        if (typeof body["prompt"] !== "string" || !body["prompt"]) {
          throw AppError.badRequest("missing_prompt", "A 'prompt' field is required");
        }
        prompt = body["prompt"];

        if (typeof body["modelId"] === "string" && body["modelId"]) {
          requestedModelId = body["modelId"];
        }

        const packageFile = body["package"];
        if (packageFile instanceof File) {
          const buf = await packageFile.arrayBuffer();
          packageContent = await analyzePackageContent(new Uint8Array(buf));
        }
      } else if (contentType.includes("application/json")) {
        // Hybrid endpoint — multipart-or-JSON. Inline Zod parse so
        // malformed JSON returns 400 invalid_body via the global RFC
        // 7807 handler instead of a raw SyntaxError 500 (#438).
        let body: { modelId?: string; messages?: unknown[]; prompt?: string };
        try {
          const text = await c.req.text();
          const raw = text.trim().length === 0 ? {} : JSON.parse(text);
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw AppError.badRequest("invalid_body", "Request body must be a JSON object");
          }
          body = raw as typeof body;
        } catch (err) {
          if (err instanceof AppError) throw err;
          throw AppError.badRequest("invalid_body", "Request body must be valid JSON");
        }
        if (typeof body.modelId === "string" && body.modelId) {
          requestedModelId = body.modelId;
        }

        // Multi-turn format: messages array
        if (body.messages && Array.isArray(body.messages)) {
          // #654 — per-message content cap. Mirrors the playground
          // chat schema's `.max(MAX_CHAT_MESSAGE_CHARS)` so both
          // surfaces enforce the same ceiling.
          for (const m of body.messages) {
            if (
              m && typeof m === "object" && "content" in m &&
              typeof (m as { content: unknown }).content === "string" &&
              (m as { content: string }).content.length > MAX_GENERATION_CHARS
            ) {
              throw AppError.badRequest(
                "content_too_long",
                `Message content exceeds ${MAX_GENERATION_CHARS} character limit`,
              );
            }
          }
          logger.info({ userId: authCtx.userId, messageCount: body.messages.length }, "Multi-turn generation request");
          const pf = await preflight(c, quotaService, llmProvidersService, requestedModelId);
          const keepAliveMs = await resolveKeepAliveMs(keepAliveIntervalMsResolver);
          return streamGenerationEvents(
            c,
            generationService.generateStreamWithHistory(
              body.messages as Array<{ role: "user" | "assistant"; content: string }>,
              c.req.raw.signal,
              pf.modelId,
            ),
            keepAliveMs,
            { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId, reservedAt: pf.reservedAt },
          );
        }

        if (!body.prompt || typeof body.prompt !== "string") {
          throw AppError.badRequest("missing_prompt", "A 'prompt' field is required");
        }
        if (body.prompt.length > MAX_GENERATION_CHARS) {
          // #654 — symmetric with the multi-turn branch above.
          throw AppError.badRequest(
            "prompt_too_long",
            `Prompt exceeds ${MAX_GENERATION_CHARS} character limit`,
          );
        }
        prompt = body.prompt;
      } else {
        throw AppError.badRequest("invalid_content_type", "Expected multipart/form-data or application/json");
      }

      const signal = c.req.raw.signal;
      const pf = await preflight(c, quotaService, llmProvidersService, requestedModelId);

      const query = packageContent
        ? `Existing skill package content:\n${packageContent}\n\nUser requirement: ${prompt}`
        : prompt;

      logger.info({ userId: authCtx.userId, promptLength: prompt.length, modelId: pf.modelId }, "Generation request");

      const keepAliveMs = await resolveKeepAliveMs(keepAliveIntervalMsResolver);
      return streamGenerationEvents(
        c,
        generationService.generateStream(query, signal, pf.modelId),
        keepAliveMs,
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId, reservedAt: pf.reservedAt },
      );
    },
  );

  /**
   * POST /skills/generate/from-source
   * Input: JSON {
   *   code?: string,         // inline source (concatenated files, "// FILE: <path>" markers optional)
   *   repoUrl?: string,      // public GitHub URL; backend fetches a small bundle of route files
   *   path?: string,         // optional subpath to look under when fetching repoUrl
   *   framework?: string,    // optional hint ("hono"/"express"/...); auto-detected otherwise
   *   description?: string,  // optional free-form context
   * }
   * Exactly one of `code` or `repoUrl` is required.
   * Response: SSE stream of generation events
   * Requires: ornn:skill:build
   */
  app.post(
    "/skills/generate/from-source",
    auth,
    requirePermission("ornn:skill:build"),
    validateBody(
      z.object({
        code: z.string().optional(),
        repoUrl: z.string().optional(),
        path: z.string().optional(),
        framework: z.string().optional(),
        description: z.string().optional(),
        modelId: z.string().optional(),
      }),
      "invalid_from_source_body",
    ),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<{
        code?: string;
        repoUrl?: string;
        path?: string;
        framework?: string;
        description?: string;
        modelId?: string;
      }>(c);

      const inlineCode = body.code;
      const repoUrl = body.repoUrl;
      const path = body.path;
      const framework = body.framework;
      const description = body.description;
      const requestedModelId = body.modelId;

      if (!inlineCode && !repoUrl) {
        throw AppError.badRequest(
          "missing_source",
          "Provide either 'code' (inline source) or 'repoUrl' (public GitHub URL)",
        );
      }
      if (inlineCode && repoUrl) {
        throw AppError.badRequest(
          "AMBIGUOUS_SOURCE",
          "Provide exactly one of 'code' or 'repoUrl', not both",
        );
      }

      let code = inlineCode ?? "";
      let fetchedFramework = framework;
      let sourceUrl: string | undefined;

      if (repoUrl) {
        try {
          const bundle = await fetchGithubSourceBundle(repoUrl, { path });
          code = bundle.code;
          fetchedFramework = framework ?? bundle.frameworkHint;
          sourceUrl = repoUrl;
          logger.info(
            {
              userId: authCtx.userId,
              repoUrl,
              fileCount: bundle.files.length,
              frameworkHint: bundle.frameworkHint,
            },
            "Fetched repo bundle for from-source generation",
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw AppError.badRequest("repo_fetch_failed", `Could not fetch repository: ${message}`);
        }
      }

      if (!code.trim()) {
        throw AppError.badRequest("empty_source", "Source code is empty — nothing to analyze");
      }

      logger.info(
        {
          userId: authCtx.userId,
          mode: repoUrl ? "repo" : "inline",
          codeLength: code.length,
          framework: fetchedFramework,
          hasDescription: !!description,
        },
        "from-source generation request",
      );

      const signal = c.req.raw.signal;
      const pf = await preflight(c, quotaService, llmProvidersService, requestedModelId);

      const keepAliveMs = await resolveKeepAliveMs(keepAliveIntervalMsResolver);
      return streamGenerationEvents(
        c,
        generationService.generateFromSource(
          code,
          { framework: fetchedFramework, description, sourceUrl },
          signal,
          pf.modelId,
        ),
        keepAliveMs,
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId, reservedAt: pf.reservedAt },
      );
    },
  );

  /**
   * POST /skills/generate/from-openapi
   * Input: JSON { spec: string (OpenAPI JSON/YAML), endpoints?: string[], description?: string }
   * Response: SSE stream of generation events
   * Requires: ornn:skill:build
   */
  app.post(
    "/skills/generate/from-openapi",
    auth,
    requirePermission("ornn:skill:build"),
    validateBody(
      z.object({
        spec: z.string().min(1),
        endpoints: z.array(z.unknown()).optional(),
        description: z.string().optional(),
        modelId: z.string().optional(),
      }),
      "invalid_from_openapi_body",
    ),
    async (c) => {
      const authCtx = getAuth(c);
      const body = getValidatedBody<{
        spec: string;
        endpoints?: unknown[];
        description?: string;
        modelId?: string;
      }>(c);

      const endpoints = body.endpoints;
      const description = body.description;
      const requestedModelId = body.modelId;

      logger.info(
        { userId: authCtx.userId, specLength: body.spec.length, endpoints, hasDescription: !!description },
        "OpenAPI generation request",
      );

      const signal = c.req.raw.signal;
      const pf = await preflight(c, quotaService, llmProvidersService, requestedModelId);

      const keepAliveMs = await resolveKeepAliveMs(keepAliveIntervalMsResolver);
      return streamGenerationEvents(
        c,
        generationService.generateFromOpenApi(
          body.spec,
          { endpoints: endpoints as string[] | undefined, description },
          signal,
          pf.modelId,
        ),
        keepAliveMs,
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId, reservedAt: pf.reservedAt },
      );
    },
  );

  return app;
}
