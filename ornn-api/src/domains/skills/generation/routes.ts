/**
 * Skill generation routes with NyxID auth.
 * POST /api/skills/generate — SSE streaming skill generation via Nyx Provider.
 * @module domains/skills/generation/routes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";
import type { SkillGenerationService } from "./service";
import type { QuotaService } from "../../quota/service";
import type { LlmProvidersService } from "../../settings/llmProviders/service";
import { throwQuotaError } from "../../quota/routes";
import { throwModelResolutionError } from "../../settings/llmProviders/routes";
import type { ChargeOutcome } from "../../quota/types";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../../middleware/nyxidAuth";
import { AppError } from "../../../shared/types/index";
import { resolveZipRoot } from "../../../shared/utils/zip";
import { validateBody, getValidatedBody } from "../../../middleware/validate";
import { rateLimit } from "../../../middleware/rateLimit";
import { fetchGithubSourceBundle } from "./githubFetcher";
import JSZip from "jszip";
import { createLogger } from "../../../shared/logger";
import { z } from "zod";

const logger = createLogger("skillGenerationRoutes");

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

/** Helper to resolve keep-alive ms with a safe fallback. */
async function resolveKeepAliveMs(
  resolver: () => Promise<number>,
): Promise<number> {
  try {
    const v = await resolver();
    return Number.isFinite(v) && v > 0 ? v : 15_000;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Failed to resolve skillGen sseKeepAliveMs; using 15s default",
    );
    return 15_000;
  }
}

/**
 * Run quota check + model resolution for a skill-gen request. Returns
 * the resolved model id; throws the appropriate AppError when either
 * gate fails (quota → 429, models → 503/4xx).
 */
async function preflight(
  c: Context<{ Variables: AuthVariables }>,
  quotaService: QuotaService,
  llmProvidersService: LlmProvidersService,
  requestedModelId: string | undefined,
): Promise<{ modelId: string; userId: string; permissions: readonly string[] | undefined }> {
  const authCtx = getAuth(c);
  const decision = await quotaService.checkAllowed({
    userId: authCtx.userId,
    permissions: authCtx.permissions,
    surface: "skillGen",
  });
  if (!decision.allowed) throwQuotaError(decision);

  const resolution = await llmProvidersService.resolveModel({
    surface: "skillGen",
    requested: requestedModelId,
  });
  if (resolution.kind !== "ok") throwModelResolutionError(resolution);
  return { modelId: resolution.modelId, userId: authCtx.userId, permissions: authCtx.permissions };
}

/**
 * Stream generation events via SSE with keep-alive. When `chargeAfter`
 * is set, fires a quota charge after the stream finishes — outcome
 * derived from whether the stream emitted a `generation_complete` event
 * (skill-side success), a `validation_error` (skill ran but produced
 * invalid output — still chargeable), or only `error` events
 * (system_error — no charge).
 */
async function streamGenerationEvents(
  c: any,
  events: AsyncIterable<{ type: string; [key: string]: unknown }>,
  keepAliveIntervalMs: number,
  chargeAfter?: {
    quotaService: QuotaService;
    userId: string;
    permissions: readonly string[] | undefined;
    /** Resolved model id used for the LLM call — flows into `usedByModel`. */
    modelId: string;
  },
) {
  c.header("Cache-Control", "no-cache");
  c.header("Connection", "keep-alive");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    const keepAlive = setInterval(() => {
      stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
    }, keepAliveIntervalMs);

    const signal = c.req.raw.signal;
    const onAbort = () => clearInterval(keepAlive);
    signal.addEventListener("abort", onAbort, { once: true });

    let outcome: ChargeOutcome = "system_error";

    try {
      for await (const event of events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === "generation_complete") outcome = "success";
        else if (event.type === "validation_error") outcome = "skill_error";
      }
    } finally {
      clearInterval(keepAlive);
      signal.removeEventListener("abort", onAbort);
      if (chargeAfter) {
        await chargeAfter.quotaService
          .chargeOnCompletion({
            userId: chargeAfter.userId,
            permissions: chargeAfter.permissions,
            surface: "skillGen",
            outcome,
            modelId: chargeAfter.modelId,
          })
          .catch((err) => {
            logger.warn(
              { userId: chargeAfter.userId, err: (err as Error).message },
              "Quota charge after skill-gen stream failed",
            );
          });
      }
    }
  });
}

/**
 * Read content from a ZIP package for analysis.
 */
async function analyzePackageContent(zipBuffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const allPaths = Object.keys(zip.files);
  resolveZipRoot(zip, allPaths);
  const parts: string[] = [];

  const relevantFiles = ["SKILL.md"];
  const relevantDirs = ["scripts/", "references/", "assets/"];

  for (const path of allPaths) {
    const file = zip.files[path];
    // allPaths is `Object.keys(zip.files)`, but noUncheckedIndexedAccess
    // (#450) widens the lookup to `T | undefined`. Defensive skip.
    if (!file || file.dir) continue;

    // Check if this is a relevant file
    const segments = path.split("/").filter(Boolean);
    let relativePath = path;
    if (segments.length > 1) {
      const firstEntry = segments[0]!;
      const folderEntry = zip.files[firstEntry + "/"];
      if (folderEntry && folderEntry.dir) {
        relativePath = segments.slice(1).join("/");
      }
    }

    const isRelevant = relevantFiles.includes(relativePath) ||
      relevantDirs.some((d) => relativePath.startsWith(d));

    if (isRelevant) {
      try {
        const content = await file.async("string");
        parts.push(`--- ${relativePath} ---\n${content}`);
      } catch (err) {
        // Skip binary or unreadable files. Log so an upload that's
        // 100% binary doesn't silently produce an empty generation
        // context (#579).
        logger.debug({ err, relativePath }, "generation: skipping unreadable file");
      }
    }
  }

  return parts.join("\n\n");
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
            { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId },
          );
        }

        if (!body.prompt || typeof body.prompt !== "string") {
          throw AppError.badRequest("missing_prompt", "A 'prompt' field is required");
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
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId },
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
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId },
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
        { quotaService, userId: pf.userId, permissions: pf.permissions, modelId: pf.modelId },
      );
    },
  );

  return app;
}
