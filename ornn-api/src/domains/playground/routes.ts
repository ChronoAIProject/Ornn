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
import type { QuotaService } from "../quota/service";
import type { ModelsService } from "../models/service";
import { throwQuotaError } from "../quota/routes";
import { throwModelResolutionError } from "../models/routes";
import type { ChargeOutcome } from "../quota/types";
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
  /**
   * Optional admin-curated model id. When omitted, falls back to the
   * surface default (or 503 if no models are enabled). When provided,
   * must be enabled for the playground surface — otherwise rejected
   * with `MODEL_NOT_ENABLED` before any LLM call.
   */
  modelId: z.string().optional(),
});

export interface PlaygroundRoutesConfig {
  chatService: PlaygroundChatService;
  keepAliveIntervalMs: number;
  /** Optional. When set together with `skillService`, the route emits a
   *  `playground` pull event each time a chat references a real skill. */
  analyticsService?: AnalyticsService;
  skillService?: SkillService;
  /** Per-user quota gate (charged on completion). */
  quotaService: QuotaService;
  /** Admin-curated model catalog. */
  modelsService: ModelsService;
}

export function createPlaygroundRoutes(config: PlaygroundRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { chatService, keepAliveIntervalMs, analyticsService, skillService, quotaService, modelsService } = config;
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

      // Quota check — rejects with 429 BEFORE any LLM cost is incurred.
      // Admins bypass via permission inside the service.
      const decision = await quotaService.checkAllowed({
        userId: authCtx.userId,
        permissions: authCtx.permissions,
        surface: "playground",
      });
      if (!decision.allowed) throwQuotaError(decision);

      // Resolve the model — explicit `modelId` (validated against the
      // surface's enabled list) or the admin-set default. 503 when no
      // models are enabled for the playground surface.
      const resolution = await modelsService.resolveModel({
        surface: "playground",
        requested: parsed.modelId,
      });
      if (resolution.kind !== "ok") throwModelResolutionError(resolution);
      const resolvedModelId = resolution.modelId;

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

        // Outcome tracks whether the run reached the skill-side. Skill
        // errors (script ran + threw) charge; system errors (LLM API
        // timeout, infra 5xx) do not. Default `system_error` is the
        // safe fallback — only flips to `success` if the stream
        // completes cleanly.
        let outcome: ChargeOutcome = "system_error";

        try {
          const signal = c.req.raw.signal;
          const chatRequest: PlaygroundChatRequest = parsed;

          for await (const event of chatService.chat(authCtx.userId, chatRequest, signal, {
            modelId: resolvedModelId,
          })) {
            await stream.writeSSE({ data: JSON.stringify(event) });
            // The chat service emits a `tool-result` once the sandbox
            // finishes. Even if the script errored, the run reached
            // the skill — that's a chargeable outcome per #250.
            if (event.type === "tool-result") outcome = "skill_error";
            // A clean finish flips the bucket to `success`.
            if (event.type === "finish") {
              const reason = (event as { finishReason?: string }).finishReason;
              if (reason === "stop") outcome = "success";
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Chat stream failed";
          logger.error({ userId: authCtx.userId, err: message }, "Chat stream error");
          await stream.writeSSE({
            data: JSON.stringify({ type: "error", message }),
          });
        } finally {
          clearInterval(keepAlive);
          // Charge on completion. Admin bypass + outcome filtering
          // handled inside the service. Errors here must not surface
          // to the caller — the response already streamed.
          await quotaService
            .chargeOnCompletion({
              userId: authCtx.userId,
              permissions: authCtx.permissions,
              surface: "playground",
              outcome,
            })
            .catch((err) => {
              logger.warn(
                { userId: authCtx.userId, err: (err as Error).message },
                "Quota charge after playground chat failed",
              );
            });
        }
      });
    },
  );

  return app;
}
