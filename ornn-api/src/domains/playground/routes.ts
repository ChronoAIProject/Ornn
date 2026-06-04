/**
 * Playground routes with NyxID auth.
 * Chat SSE streaming endpoint.
 * @module domains/playground/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import type { PlaygroundChatService, PlaygroundChatRequest } from "./chatService";
import type { SkillService } from "../skills/crud/service";
import type { AnalyticsService } from "../analytics/service";
import type { QuotaService } from "../quota/service";
import type { LlmProvidersService } from "../settings/llmProviders/service";
import { throwQuotaError } from "../quota/routes";
import { throwModelResolutionError } from "../settings/llmProviders/routes";
import type { ChargeOutcome } from "../quota/types";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  requirePermission,
  getAuth,
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { createLogger } from "../../shared/logger";
const logger = createLogger("playgroundRoutes");

// Zod schemas

/**
 * Per-message content cap (#654). Mirrors the frontend `MAX_INPUT_CHARS`
 * in `ornn-web/src/components/playground/ChatInput.tsx`. ~8k tokens at
 * 4 chars/token — generous for interactive prompts without enabling
 * whole-novel pastes. The textarea hard-caps at this value via its
 * `maxLength`, but the backend duplicates the check so a malicious /
 * non-browser client can't slip past.
 */
const MAX_CHAT_MESSAGE_CHARS = 32_000;

const playgroundMessageSchema = z.object({
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string().max(
    MAX_CHAT_MESSAGE_CHARS,
    `Message content exceeds ${MAX_CHAT_MESSAGE_CHARS} character limit`,
  ),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.string(), z.unknown()),
  })).optional(),
  toolCallId: z.string().optional(),
});

const chatRequestSchema = z.object({
  messages: z.array(playgroundMessageSchema).min(1).max(100),
  skillId: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
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
  /**
   * SSE keep-alive interval (ms). Resolved from admin settings
   * (`playground.sseKeepAliveMs`) on every request — admin edits land
   * on the next chat without a restart.
   */
  keepAliveIntervalMsResolver: () => Promise<number>;
  /** Optional. When set together with `skillService`, the route emits a
   *  `playground` pull event each time a chat references a real skill. */
  analyticsService?: AnalyticsService;
  skillService?: SkillService;
  /** Per-user quota gate (charged on completion). */
  quotaService: QuotaService;
  /** Admin-curated model catalog (per-provider, #270). */
  llmProvidersService: LlmProvidersService;
}

export function createPlaygroundRoutes(config: PlaygroundRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { chatService, keepAliveIntervalMsResolver, analyticsService, skillService, quotaService, llmProvidersService } = config;
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
      const resolution = await llmProvidersService.resolveModel({
        surface: "playground",
        // exactOptionalPropertyTypes (#657)
        ...(parsed.modelId !== undefined ? { requested: parsed.modelId } : {}),
      });
      if (resolution.kind !== "ok") throwModelResolutionError(resolution);
      const resolvedModelId = resolution.modelId;

      // #806 — build the caller's object-level authorization actor and
      // thread it into the chat service. This mirrors the actor build in
      // GET /skills/:idOrName/json and depends on nyxidOrgLookupMiddleware
      // being mounted in bootstrap.ts ahead of the playground routes so
      // `readUserOrgMemberships` resolves the caller's org memberships.
      // The chat service uses this single actor to gate BOTH skill bypass
      // paths (the `skillId` injection and the `load_skill` tool).
      const memberships = await readUserOrgMemberships(c);
      const actor = {
        userId: authCtx.userId,
        memberships,
        isPlatformAdmin: authCtx.permissions.includes("ornn:admin:skill"),
      };

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

      // Outcome tracks whether the run reached the skill-side. Skill
      // errors (script ran + threw) charge; system errors (LLM API
      // timeout, infra 5xx) do not. Default `system_error` is the
      // safe fallback — only flips to `success` if the stream
      // completes cleanly.
      let outcome: ChargeOutcome = "system_error";

      const encoder = new TextEncoder();
      const signal = c.req.raw.signal;
      const chatRequest: PlaygroundChatRequest = parsed;

      // TransformStream: writer.write() back-pressures naturally against
      // Bun's response consumer, so each `await writer.write(chunk)`
      // resolves only after the chunk has been picked up by the HTTP
      // writer. This forces real per-event flushing — the previous
      // `ReadableStream.start(controller) + IIFE + controller.enqueue`
      // pattern coalesced 2,000+ enqueues into a single delivery at
      // stream close under Bun (verified via the EventStream tab: every
      // event arrived at the browser at the same millisecond despite
      // upstream LLM emitting deltas over ~45s).
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();

      let writerClosed = false;
      const closeOnce = async () => {
        if (writerClosed) return;
        writerClosed = true;
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
      };
      const writeFrame = async (frame: string) => {
        if (writerClosed) return;
        try {
          await writer.write(encoder.encode(frame));
        } catch {
          writerClosed = true;
        }
      };
      const writeEvent = (payload: unknown) =>
        writeFrame(`data: ${JSON.stringify(payload)}\n\n`);

      // Pre-flush a fat comment frame so the response headers + first
      // chunk hit the wire immediately. SSE comments are spec-mandated
      // ignores by the browser parser. The 2KB padding defeats any
      // intermediate proxy that holds the connection until ~2-4KB
      // arrives.
      const padding = " ".repeat(2048);
      void writeFrame(`: stream-open ${Date.now()} ${padding}\n\n`);

      // Keepalive defeats idle-timeout proxies during LLM warmup. The
      // interval is read from settings on every request — fall back to
      // a conservative 15s when the resolver throws so a transient
      // settings outage doesn't break streaming.
      let keepAliveMs = 15_000;
      try {
        const resolved = await keepAliveIntervalMsResolver();
        if (Number.isFinite(resolved) && resolved > 0) keepAliveMs = resolved;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          "Failed to resolve playground sseKeepAliveMs; using 15s default",
        );
      }
      const keepAlive = setInterval(() => {
        void writeFrame(`: keepalive ${Date.now()}\n\n`);
      }, keepAliveMs);

      const onAbort = () => {
        clearInterval(keepAlive);
        void closeOnce();
      };
      signal.addEventListener("abort", onAbort);

      // Producer task — pumps chat events into the writer. Runs in
      // background; the response is returned synchronously below.
      void (async () => {
        try {
          for await (const event of chatService.chat(authCtx.userId, chatRequest, signal, {
            modelId: resolvedModelId,
            actor,
          })) {
            await writeEvent(event);
            if (event.type === "tool-result") outcome = "skill_error";
            if (event.type === "finish") {
              const reason = (event as { finishReason?: string }).finishReason;
              if (reason === "stop") outcome = "success";
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Chat stream failed";
          logger.error({ userId: authCtx.userId, err: message }, "Chat stream error");
          await writeEvent({ type: "error", message });
        } finally {
          signal.removeEventListener("abort", onAbort);
          clearInterval(keepAlive);
          await closeOnce();
          await quotaService
            .chargeOnCompletion({
              userId: authCtx.userId,
              permissions: authCtx.permissions,
              surface: "playground",
              outcome,
              modelId: resolvedModelId,
            })
            .catch((err) => {
              logger.warn(
                { userId: authCtx.userId, err: (err as Error).message },
                "Quota charge after playground chat failed",
              );
            });
        }
      })();

      return new Response(readable, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
  );

  return app;
}
