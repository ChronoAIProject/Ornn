/**
 * Playground routes with NyxID auth.
 * Chat SSE streaming endpoint.
 * @module domains/playground/routes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { PlaygroundChatService, PlaygroundChatRequest } from "./chatService";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "playgroundRoutes" });

// Zod schemas
const playgroundMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
  })).optional(),
  toolCallId: z.string().optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(playgroundMessageSchema).min(1).max(100),
  skillId: z.string().optional(),
  envVars: z.record(z.string()).optional(),
});

export interface PlaygroundRoutesConfig {
  chatService: PlaygroundChatService;
  keepAliveIntervalMs: number;
}

export function createPlaygroundRoutes(config: PlaygroundRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { chatService, keepAliveIntervalMs } = config;
  const app = new Hono<{ Variables: AuthVariables }>();

  const auth = nyxidAuthMiddleware();

  // All playground routes require auth + playground permission
  app.use("/playground/*", auth);

  // -------------------------------------------------------------------------
  // Chat (SSE Streaming)
  // -------------------------------------------------------------------------

  app.post(
    "/playground/chat",
    requirePermission("ornn:playground:use"),
    async (c) => {
      const authCtx = getAuth(c);
      const body = await c.req.json();
      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw AppError.badRequest(
          "VALIDATION_ERROR",
          parsed.error.issues.map((i) => i.message).join(", "),
        );
      }

      logger.info({ userId: authCtx.userId, messageCount: parsed.data.messages.length }, "Chat request");

      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, async (stream) => {
        const keepAlive = setInterval(() => {
          stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
        }, keepAliveIntervalMs);

        try {
          const signal = c.req.raw.signal;
          const chatRequest: PlaygroundChatRequest = parsed.data;

          for await (const event of chatService.chat(authCtx.userId, chatRequest, signal)) {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Chat stream failed";
          logger.error({ userId: authCtx.userId, err: message }, "Chat stream error");
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message }),
          });
        } finally {
          clearInterval(keepAlive);
        }
      });
    },
  );

  return app;
}
