/**
 * Playground routes with NyxID auth.
 * Chat SSE streaming endpoint.
 * @module domains/playground/routes
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { PlaygroundChatService, PlaygroundChatRequest } from "./chatService";
import type { SkillService } from "../skills/crud/service";
import type { AnalyticsService } from "../analytics/service";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
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
  /** Optional. When set together with `skillService`, the route emits a
   *  `playground` pull event each time a chat references a real skill. */
  analyticsService?: AnalyticsService;
  skillService?: SkillService;
}

export function createPlaygroundRoutes(config: PlaygroundRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { chatService, keepAliveIntervalMs, analyticsService, skillService } = config;
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
    validateBody(chatRequestSchema, "VALIDATION_ERROR"),
    async (c) => {
      const authCtx = getAuth(c);
      const parsed = getValidatedBody<z.infer<typeof chatRequestSchema>>(c);

      logger.info({ userId: authCtx.userId, messageCount: parsed.messages.length }, "Chat request");

      // Record a `playground` pull if the chat is bound to a skill. The
      // chat service loads the skill internally; we duplicate the lookup
      // here so analytics doesn't change the chat-service contract. Cost
      // is one cached MongoDB read per chat session opening.
      if (analyticsService && skillService && parsed.skillId) {
        void skillService
          .getSkill(parsed.skillId)
          .then((skill) =>
            analyticsService.recordPull({
              skillGuid: skill.guid,
              skillName: skill.name,
              skillVersion: skill.version,
              userId: authCtx.userId,
              source: "playground",
            }),
          )
          .catch(() => {
            /* analytics failures must not surface to the caller */
          });
      }

      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      return streamSSE(c, async (stream) => {
        const keepAlive = setInterval(() => {
          stream.writeSSE({ data: "", event: "keepalive" }).catch(() => {});
        }, keepAliveIntervalMs);

        try {
          const signal = c.req.raw.signal;
          const chatRequest: PlaygroundChatRequest = parsed;

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
