/**
 * Skill generation routes with NyxID auth.
 * POST /api/skills/generate — SSE streaming skill generation via Nyx Provider.
 * @module domains/skillGeneration/routes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SkillGenerationService } from "./service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import { resolveZipRoot } from "../../shared/utils/zip";
import JSZip from "jszip";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "skillGenerationRoutes" });

export interface GenerationRoutesConfig {
  generationService: SkillGenerationService;
  keepAliveIntervalMs: number;
}

/**
 * Stream generation events via SSE with keep-alive.
 */
async function streamGenerationEvents(
  c: any,
  events: AsyncIterable<{ type: string; [key: string]: unknown }>,
  keepAliveIntervalMs: number,
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

    try {
      for await (const event of events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } finally {
      clearInterval(keepAlive);
      signal.removeEventListener("abort", onAbort);
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
    if (file.dir) continue;

    // Check if this is a relevant file
    const segments = path.split("/").filter(Boolean);
    let relativePath = path;
    if (segments.length > 1) {
      const firstEntry = segments[0];
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
      } catch {
        // Skip binary or unreadable files
      }
    }
  }

  return parts.join("\n\n");
}

export function createGenerationRoutes(config: GenerationRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { generationService, keepAliveIntervalMs } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  /**
   * POST /skills/generate
   * Input: multipart (prompt + optional package ZIP) or JSON (prompt or messages)
   * Response: SSE stream of generation events
   * Requires: ornn:skill:build
   */
  app.post(
    "/skills/generate",
    auth,
    requirePermission("ornn:skill:build"),
    async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      const authCtx = getAuth(c);
      let prompt: string;
      let packageContent: string | null = null;

      if (contentType.includes("multipart/form-data")) {
        const body = await c.req.parseBody({ all: true });

        if (typeof body["prompt"] !== "string" || !body["prompt"]) {
          throw AppError.badRequest("MISSING_PROMPT", "A 'prompt' field is required");
        }
        prompt = body["prompt"];

        const packageFile = body["package"];
        if (packageFile instanceof File) {
          const buf = await packageFile.arrayBuffer();
          packageContent = await analyzePackageContent(new Uint8Array(buf));
        }
      } else if (contentType.includes("application/json")) {
        const body = await c.req.json();

        // Multi-turn format: messages array
        if (body.messages && Array.isArray(body.messages)) {
          logger.info({ userId: authCtx.userId, messageCount: body.messages.length }, "Multi-turn generation request");
          return streamGenerationEvents(
            c,
            generationService.generateStreamWithHistory(body.messages, c.req.raw.signal),
            keepAliveIntervalMs,
          );
        }

        if (!body.prompt || typeof body.prompt !== "string") {
          throw AppError.badRequest("MISSING_PROMPT", "A 'prompt' field is required");
        }
        prompt = body.prompt;
      } else {
        throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected multipart/form-data or application/json");
      }

      const signal = c.req.raw.signal;

      const query = packageContent
        ? `Existing skill package content:\n${packageContent}\n\nUser requirement: ${prompt}`
        : prompt;

      logger.info({ userId: authCtx.userId, promptLength: prompt.length }, "Generation request");

      return streamGenerationEvents(
        c,
        generationService.generateStream(query, signal),
        keepAliveIntervalMs,
      );
    },
  );

  return app;
}
