/**
 * Ornn Assistant domain types (#970).
 *
 * The assistant is a pure, non-agentic Q&A chatbot: it answers questions
 * about Ornn (grounded in the curated KB) and about skills the caller is
 * allowed to see (grounded in a visibility-scoped retrieval). It never
 * runs tools, executes skills, or mutates state.
 *
 * The SSE event union here is the WIRE CONTRACT the frontend is built
 * against — `chat_start` / `chat_text_delta` / `chat_error` / `chat_finish`
 * (+ keepalive comment frames). The route serializes each event to an SSE
 * frame whose `event:` line equals the `type` field (CONVENTIONS §6).
 *
 * @module domains/assistant/types
 */

/** The LLM surface key this domain reserves/charges/resolves against. */
export const ASSISTANT_SURFACE = "assistant" as const;

/** Inbound chat turn. Only user/assistant roles — no tool/system turns. */
export interface AssistantMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AssistantChatRequest {
  readonly messages: ReadonlyArray<AssistantMessage>;
  /**
   * Optional admin-curated model id; falls back to the surface default.
   * Widened to `| undefined` so a Zod `.optional()`-inferred body assigns
   * cleanly under exactOptionalPropertyTypes (#657).
   */
  readonly modelId?: string | undefined;
}

/** Optional token-usage report attached to `chat_finish`. */
export interface AssistantUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

/**
 * SSE event union (the wire contract). Every event carries `type`; the
 * route mirrors it onto the SSE `event:` line.
 */
export type AssistantChatEvent =
  | { readonly type: "chat_start"; readonly model: string }
  | { readonly type: "chat_text_delta"; readonly delta: string }
  | { readonly type: "chat_error"; readonly code: string; readonly message: string }
  | { readonly type: "chat_finish"; readonly usage?: AssistantUsage };

/**
 * SAFE projection of a skill for grounding (#970 data-safety). ONLY these
 * fields ever reach the LLM context or the user. Deliberately excludes
 * every PII / secret / private-membership field on the source document:
 * createdByEmail, createdByDisplayName, storageKey, skillHash,
 * sharedWithUsers, sharedWithOrgs, isPrivate, license, and so on.
 */
export interface RetrievedSkill {
  readonly name: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly category: string;
  /** ISO-8601 string. */
  readonly createdOn: string;
  /** Author person user_id only — never an email/display name. */
  readonly createdBy: string;
}
