/**
 * Skill generation route.
 * POST /skills/generate — accepts multipart with prompt (string) and optional package (application/zip).
 * Streams generation events via SSE.
 * @module routes/skillGenerateRoutes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ISkillGenerationService } from "../services/skillGenerationService";
import type { TokenVerifier } from "ornn-shared";
import { createAuthMiddleware, getAuth, type AuthVariables, AppError } from "ornn-shared";
import JSZip from "jszip";
import { fetchUserLlmConfig } from "../services/userLlmConfigFetcher";
import { createLlmClientFromConfig } from "../services/llmClientFactory";

/**
 * Streams generation events via SSE, clearing the keep-alive
 * interval on completion or client disconnect.
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
 * Extracts SKILL.md + scripts/ + references/ + assets/ content into a single text block.
 */
async function analyzePackageContent(zipBuffer: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const parts: string[] = [];

  const entries = Object.keys(zip.files);
  for (const path of entries) {
    const file = zip.files[path];
    if (file.dir) continue;
    // Get the relative path (strip any wrapping folder)
    const segments = path.split("/").filter(Boolean);
    let relativePath = path;
    if (segments.length > 1) {
      // Check if first segment is a wrapping folder
      const firstEntry = segments[0];
      const folderEntry = zip.files[firstEntry + "/"];
      if (folderEntry && folderEntry.dir) {
        relativePath = segments.slice(1).join("/");
      }
    }

    // Only include relevant files
    if (
      relativePath === "SKILL.md" ||
      relativePath.startsWith("scripts/") ||
      relativePath.startsWith("references/") ||
      relativePath.startsWith("assets/")
    ) {
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

/**
 * Creates the skill generation route.
 * POST /skills/generate — multipart with prompt (string) and optional package (ZIP).
 * Streams response via SSE.
 */
export function createSkillGenerateRoutes(
  generationService: ISkillGenerationService,
  tokenService: TokenVerifier,
  keepAliveIntervalMs = 15_000,
  playgroundInternalUrl = "",
  internalServiceSecret = "",
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();

  const authMiddleware = createAuthMiddleware(tokenService);
  app.use("/skills/generate", authMiddleware);

  /**
   * POST /skills/generate
   * Input: multipart — prompt (string), optional package (application/zip)
   * Response: SSE stream of generation events
   */
  app.post("/skills/generate", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    let prompt = "";
    let packageContent: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const body = await c.req.parseBody({ all: true });

      if (typeof body["prompt"] !== "string" || !body["prompt"]) {
        throw AppError.badRequest("MISSING_PROMPT", "A 'prompt' field is required");
      }
      prompt = body["prompt"];

      // Check for optional package ZIP
      const packageFile = body["package"];
      if (packageFile instanceof File) {
        const buf = await packageFile.arrayBuffer();
        packageContent = await analyzePackageContent(new Uint8Array(buf));
      }
    } else if (contentType.includes("application/json")) {
      const body = await c.req.json();

      // Multi-turn format: messages array with user's own LLM
      if (body.messages && Array.isArray(body.messages) && body.useUserLlm) {
        const auth = getAuth(c);
        const userConfig = await fetchUserLlmConfig(
          auth.userId,
          playgroundInternalUrl,
          internalServiceSecret,
        );
        const client = createLlmClientFromConfig(userConfig);

        return streamGenerationEvents(
          c,
          generationService.generateStreamWithHistory(body.messages, client, c.req.raw.signal),
          keepAliveIntervalMs,
        );
      }

      // Legacy single prompt format
      if (!body.prompt || typeof body.prompt !== "string") {
        throw AppError.badRequest("MISSING_PROMPT", "A 'prompt' field is required");
      }
      prompt = body.prompt;
    } else {
      throw AppError.badRequest("INVALID_CONTENT_TYPE", "Expected multipart/form-data or application/json");
    }

    const signal = c.req.raw.signal;

    // Build the generation query per spec:
    // If package exists: analyze it + inject rules + user prompt
    // If no package: rules + user prompt
    const query = packageContent
      ? `Existing skill package content:\n${packageContent}\n\nUser requirement: ${prompt}`
      : prompt;

    return streamGenerationEvents(
      c,
      generationService.generateStreamDirect(query, signal),
      keepAliveIntervalMs,
    );
  });

  return app;
}
