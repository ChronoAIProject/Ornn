/**
 * Ornn Assistant routes (#970).
 *
 *   POST /assistant/chat   — AUTH REQUIRED, SSE.
 *
 * Pipeline (mirrors the playground reference, CONVENTIONS-compliant):
 *   nyxidAuth → rateLimit → validateBody → resolveModel(assistant) →
 *   buildActorContext → quota reserve(assistant) → stream → charge.
 *
 * Model resolution + the quota reserve run BEFORE the stream opens, so a
 * misconfig / cap-hit returns a clean RFC 7807 JSON error (never a broken
 * SSE stream). Once the stream opens, in-stream failures surface as a
 * `chat_error` event. Everything from the quota reserve to the producer's
 * `finally` is await-safe, so a reserved slot is always reconciled.
 *
 * SSE frames carry BOTH the native `event:` line and a JSON `data:` line
 * whose `type` equals the event name (CONVENTIONS §6.3).
 *
 * @module domains/assistant/routes
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  getAuth,
} from "../../middleware/nyxidAuth";
import { validateBody, getValidatedBody } from "../../middleware/validate";
import { rateLimit } from "../../middleware/rateLimit";
import { createLogger } from "../../shared/logger";
import { buildActorContext } from "../skills/crud/authorize";
import { throwQuotaError } from "../quota/routes";
import { throwModelResolutionError } from "../settings/llmProviders/routes";
import type { ChargeOutcome } from "../quota/types";
import type { QuotaService } from "../quota/service";
import type { LlmProvidersService } from "../settings/llmProviders/service";
import type { AssistantChatService } from "./chatService";
import { ASSISTANT_SURFACE, type AssistantChatRequest } from "./types";

const logger = createLogger("assistantRoutes");

/**
 * Per-message content cap — mirrors the playground's `MAX_CHAT_MESSAGE_CHARS`
 * (~8k tokens at 4 chars/token). The backend enforces it independently of
 * any frontend `maxLength` so a non-browser client can't slip past.
 */
const MAX_CHAT_MESSAGE_CHARS = 32_000;

const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .max(
      MAX_CHAT_MESSAGE_CHARS,
      `Message content exceeds ${MAX_CHAT_MESSAGE_CHARS} character limit`,
    ),
});

export const assistantChatRequestSchema = z.object({
  messages: z.array(assistantMessageSchema).min(1).max(100),
  modelId: z.string().optional(),
});

export interface AssistantRoutesConfig {
  readonly chatService: AssistantChatService;
  readonly quotaService: QuotaService;
  readonly llmProvidersService: LlmProvidersService;
  /** SSE keep-alive interval (ms); resolved per-request from settings. */
  readonly keepAliveIntervalMsResolver: () => Promise<number>;
}

export function createAssistantRoutes(
  config: AssistantRoutesConfig,
): Hono<{ Variables: AuthVariables }> {
  const { chatService, quotaService, llmProvidersService, keepAliveIntervalMsResolver } =
    config;
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  app.post(
    "/assistant/chat",
    auth,
    // Per-user rate limit (#809 class). Assistant Q&A is one completion
    // per request — cheaper than the playground tool loop — but still an
    // LLM call, so it's capped. Mounted before validateBody so a flood of
    // malformed bodies 429s before Zod and before any LLM cost.
    rateLimit({ windowMs: 60_000, max: 30, label: "assistant-chat" }),
    validateBody(assistantChatRequestSchema, "VALIDATION_ERROR"),
    async (c) => {
      const authCtx = getAuth(c);
      const parsed = getValidatedBody<z.infer<typeof assistantChatRequestSchema>>(c);

      logger.info(
        { userId: authCtx.userId, messageCount: parsed.messages.length },
        "Assistant chat request",
      );

      // Resolve model (assistant surface) BEFORE the quota reserve so a
      // model/config failure can't strand a reserved slot. Pure read — no
      // LLM cost — so "429 before LLM cost" still holds.
      const resolution = await llmProvidersService.resolveModel({
        surface: ASSISTANT_SURFACE,
        ...(parsed.modelId !== undefined ? { requested: parsed.modelId } : {}),
      });
      if (resolution.kind !== "ok") throwModelResolutionError(resolution);
      const resolvedModelId = resolution.modelId;

      // Object-level actor (org memberships resolved via the lookup
      // middleware mounted ahead of these routes in bootstrap). Used by
      // the scoped skill retrieval inside the chat service.
      const actor = await buildActorContext(c);

      // Quota reserve (assistant surface) — atomic cap-guarded claim,
      // rejects with 429 BEFORE any LLM cost. Admins bypass inside the
      // service. Capture the instant so the eventual charge lands in the
      // same month bucket the slot was reserved against (#827).
      const reservedAt = new Date();
      const decision = await quotaService.checkAllowed({
        userId: authCtx.userId,
        permissions: authCtx.permissions,
        surface: ASSISTANT_SURFACE,
        now: reservedAt,
      });
      if (!decision.allowed) throwQuotaError(decision);

      // Outcome defaults to system_error (refundable); flips to success
      // on a clean finish. `chargeableStarted` flips on the first real
      // text delta — once tokens stream the LLM has billed, so an
      // abort/error after that commits instead of refunding (#766).
      let outcome: ChargeOutcome = "system_error";
      let chargeableStarted = false;

      const encoder = new TextEncoder();
      const signal = c.req.raw.signal;
      const chatRequest: AssistantChatRequest = parsed;

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
      // Each SSE frame carries the native `event:` line + a JSON `data:`
      // line whose `type` equals the event name (CONVENTIONS §6.3).
      const writeEvent = (event: { type: string; [k: string]: unknown }) =>
        writeFrame(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

      // Pre-flush a padded comment so headers + first chunk hit the wire
      // immediately and proxies that buffer until ~2-4KB release early.
      const padding = " ".repeat(2048);
      void writeFrame(`: stream-open ${Date.now()} ${padding}\n\n`);

      let keepAliveMs = 15_000;
      try {
        const resolved = await keepAliveIntervalMsResolver();
        if (Number.isFinite(resolved) && resolved > 0) keepAliveMs = resolved;
      } catch (err) {
        logger.warn(
          { err: (err as Error).message },
          "Failed to resolve assistant sseKeepAliveMs; using 15s default",
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

      void (async () => {
        try {
          for await (const event of chatService.chat(actor, chatRequest, signal, {
            modelId: resolvedModelId,
          })) {
            await writeEvent(event);
            if (event.type === "chat_text_delta" && event.delta.length > 0) {
              chargeableStarted = true;
            }
            if (event.type === "chat_finish") outcome = "success";
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Assistant stream failed";
          logger.error({ userId: authCtx.userId, err: message }, "Assistant stream error");
          await writeEvent({ type: "chat_error", code: "upstream_unavailable", message });
        } finally {
          signal.removeEventListener("abort", onAbort);
          clearInterval(keepAlive);
          await closeOnce();
          if (chargeableStarted && outcome === "system_error") {
            // Tokens already streamed (billed) before an abort/error —
            // commit the reserved slot instead of refunding it (#766).
            outcome = "skill_error";
          }
          await quotaService
            .chargeOnCompletion({
              userId: authCtx.userId,
              permissions: authCtx.permissions,
              surface: ASSISTANT_SURFACE,
              outcome,
              modelId: resolvedModelId,
              now: reservedAt,
            })
            .catch((err) => {
              logger.warn(
                { userId: authCtx.userId, err: (err as Error).message },
                "Quota charge after assistant chat failed",
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
