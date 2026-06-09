/**
 * Frontend type definitions for the Ornn Assistant feature (#970).
 *
 * The Assistant is a repo-aware Q&A chatbot. It reuses the Playground SSE
 * transport stack but speaks its OWN event contract — the event `type`
 * strings are distinct from the Playground's (`chat_text_delta` vs
 * `text-delta`, etc.) so the two streams never get cross-wired.
 *
 * The event union is Zod-typed: every `data:` payload coming off the SSE
 * stream is validated by `assistantChatEventSchema` before the hook acts
 * on it. No `as any` / unchecked casts — a drifting backend surfaces as a
 * dropped (failed-parse) event rather than a runtime crash deep in the UI.
 *
 * @module types/assistant
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Conversation messages
// ---------------------------------------------------------------------------

/**
 * A single turn in the assistant conversation. Structurally a subset of
 * `PlaygroundMessage` (id/role/content) so the existing `ChatMessage`
 * renderer can paint these without adaptation — the assistant has no tool
 * calls, so the optional tool fields are simply absent.
 */
export interface AssistantMessage {
  /** Stable unique identifier for React reconciliation. */
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** Wire shape sent up in the request body — role + content only. */
export interface AssistantWireMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// SSE event contract (mirrors the backend POST /api/v1/assistant/chat)
// ---------------------------------------------------------------------------

/** Stream opened; carries the resolved model id the backend chose. */
export const assistantChatStartSchema = z.object({
  type: z.literal("chat_start"),
  model: z.string(),
});

/** Incremental assistant text. Appended to the live answer buffer. */
export const assistantChatTextDeltaSchema = z.object({
  type: z.literal("chat_text_delta"),
  delta: z.string(),
});

/** Terminal error. `code` is a stable machine token; `message` is human copy. */
export const assistantChatErrorSchema = z.object({
  type: z.literal("chat_error"),
  code: z.string(),
  message: z.string(),
});

/**
 * Usage accounting attached to `chat_finish`. Shape is advisory — the
 * backend may add fields, so unknown keys are tolerated (Zod strips them)
 * and every known field is optional.
 */
export const assistantUsageSchema = z
  .object({
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),
  })
  .optional();

/** Terminal success; optional `usage` accounting. */
export const assistantChatFinishSchema = z.object({
  type: z.literal("chat_finish"),
  usage: assistantUsageSchema,
});

/**
 * Heartbeat to keep the connection warm through proxies. Carries no
 * payload and is ignored by the consumer — present in the union so it
 * parses cleanly instead of being dropped as "unknown".
 */
export const assistantKeepaliveSchema = z.object({
  type: z.literal("keepalive"),
});

/** Discriminated union over every assistant SSE event. */
export const assistantChatEventSchema = z.discriminatedUnion("type", [
  assistantChatStartSchema,
  assistantChatTextDeltaSchema,
  assistantChatErrorSchema,
  assistantChatFinishSchema,
  assistantKeepaliveSchema,
]);

export type AssistantChatStartEvent = z.infer<typeof assistantChatStartSchema>;
export type AssistantChatTextDeltaEvent = z.infer<typeof assistantChatTextDeltaSchema>;
export type AssistantChatErrorEvent = z.infer<typeof assistantChatErrorSchema>;
export type AssistantChatFinishEvent = z.infer<typeof assistantChatFinishSchema>;
export type AssistantChatEvent = z.infer<typeof assistantChatEventSchema>;
export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

/**
 * Validate one parsed SSE payload against the event union.
 * Returns the typed event on success, or `null` for anything that doesn't
 * match (malformed / unknown / drifted) so callers can simply skip it.
 */
export function parseAssistantEvent(payload: unknown): AssistantChatEvent | null {
  const result = assistantChatEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}
