/**
 * Ornn Assistant chat service (#970) — pure Q&A, ONE streamed completion.
 *
 * Per request:
 *   1. emit `chat_start`,
 *   2. run a deterministic, visibility-scoped skill retrieval on the
 *      latest user message (failures are non-fatal — KB-only still
 *      answers),
 *   3. assemble grounding (curated KB + scoped skills) + the conversation,
 *   4. stream ONE completion via `NyxLlmClient.stream` (NO tools, NO
 *      agentic loop), mapping text deltas → `chat_text_delta`,
 *   5. emit `chat_finish` (with usage when the provider reports it) or
 *      `chat_error` on failure.
 *
 * This service yields the WIRE-CONTRACT events directly; the route only
 * serializes them to SSE frames and reconciles quota. Keeping the mapping
 * here (not the route) makes the event sequence unit-testable without HTTP.
 *
 * @module domains/assistant/chatService
 */

import { createLogger } from "../../shared/logger";
import type {
  NyxLlmClient,
  ResponsesApiStreamEvent,
} from "../../clients/nyxid/llm";
import type { ActorContext } from "../skills/crud/authorize";
import type { AssistantKbLoader } from "./kb/loader";
import type { ScopedSkillRetriever } from "./retrieval";
import { assembleAssistantInput } from "./contextAssembler";
import type {
  AssistantChatEvent,
  AssistantChatRequest,
  AssistantUsage,
  RetrievedSkill,
} from "./types";

const logger = createLogger("assistantChatService");

/** Per-request model + sampling snapshot resolved from settings. */
export interface AssistantChatDefaults {
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
}

export interface AssistantChatServiceDeps {
  readonly llmClient: Pick<NyxLlmClient, "stream">;
  readonly kbLoader: Pick<AssistantKbLoader, "load">;
  readonly retriever: Pick<ScopedSkillRetriever, "retrieve">;
  readonly defaultsResolver: () => Promise<AssistantChatDefaults>;
}

export class AssistantChatService {
  private readonly llmClient: Pick<NyxLlmClient, "stream">;
  private readonly kbLoader: Pick<AssistantKbLoader, "load">;
  private readonly retriever: Pick<ScopedSkillRetriever, "retrieve">;
  private readonly defaultsResolver: () => Promise<AssistantChatDefaults>;

  constructor(deps: AssistantChatServiceDeps) {
    this.llmClient = deps.llmClient;
    this.kbLoader = deps.kbLoader;
    this.retriever = deps.retriever;
    this.defaultsResolver = deps.defaultsResolver;
  }

  async *chat(
    actor: ActorContext,
    request: AssistantChatRequest,
    abortSignal: AbortSignal | undefined,
    options: { modelId: string },
  ): AsyncGenerator<AssistantChatEvent> {
    const defaults = await this.defaultsResolver();
    const model = options.modelId || defaults.model;
    yield { type: "chat_start", model };

    // Visibility-scoped retrieval on the latest user message. Non-fatal:
    // a retrieval failure must not deny the user a KB-grounded answer.
    const query = latestUserMessage(request.messages);
    let skills: RetrievedSkill[] = [];
    try {
      skills = await this.retriever.retrieve(query, actor);
    } catch (err) {
      logger.warn(
        { actor: actor.userId, err: (err as Error).message },
        "assistant skill retrieval failed — proceeding KB-only",
      );
    }

    const kb = this.kbLoader.load();
    const { input } = assembleAssistantInput({
      kbText: kb.text,
      skills,
      messages: request.messages,
    });

    logger.info(
      {
        actor: actor.userId,
        model,
        turns: request.messages.length,
        retrievedSkills: skills.length,
        kbTokens: kb.estimatedTokens,
      },
      "assistant chat starting",
    );

    let usage: AssistantUsage | undefined;
    try {
      const stream = this.llmClient.stream({
        model,
        input,
        max_output_tokens: defaults.maxOutputTokens,
        temperature: defaults.temperature,
        // NO tools — pure Q&A. This is the structural guarantee that the
        // assistant can never trigger an agentic tool/execution loop.
      });

      for await (const event of stream) {
        if (abortSignal?.aborted) {
          logger.info({ actor: actor.userId }, "assistant stream aborted by client");
          return;
        }
        const delta = extractTextDelta(event);
        if (delta) {
          yield { type: "chat_text_delta", delta };
          continue;
        }
        const reported = extractUsage(event);
        if (reported) usage = reported;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assistant stream failed";
      logger.error({ actor: actor.userId, err: message }, "assistant stream error");
      yield { type: "chat_error", code: mapErrorCode(message), message };
      return;
    }

    yield { type: "chat_finish", ...(usage ? { usage } : {}) };
  }
}

/** Latest user-authored message content (empty string if none). */
export function latestUserMessage(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  return "";
}

/**
 * Extract incremental text from a Responses-API stream event, handling
 * both the direct `output_text.delta` and the `content_part.delta`
 * variants. Returns null for non-text events.
 */
function extractTextDelta(event: ResponsesApiStreamEvent): string | null {
  if (event.type === "response.output_text.delta") {
    return typeof event.delta === "string" ? event.delta : null;
  }
  if (event.type === "response.content_part.delta") {
    const delta = event.delta as { type?: string; text?: string } | undefined;
    if (delta?.type === "output_text" && typeof delta.text === "string") {
      return delta.text;
    }
  }
  return null;
}

/**
 * Best-effort token-usage extraction from the terminal `response.completed`
 * event (Responses-API format only — the chat-completion normalizer drops
 * usage, so `chat_finish` simply omits it there).
 */
function extractUsage(event: ResponsesApiStreamEvent): AssistantUsage | null {
  if (event.type !== "response.completed") return null;
  const response = event.response as { usage?: Record<string, unknown> } | undefined;
  const usage = response?.usage;
  if (!usage || typeof usage !== "object") return null;
  const out: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  if (typeof usage.input_tokens === "number") out.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") out.outputTokens = usage.output_tokens;
  if (typeof usage.total_tokens === "number") out.totalTokens = usage.total_tokens;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Map a thrown stream error to an SSE `chat_error.code` from the ERRORS.md
 * catalog. Every LLM/gateway failure (including "no provider configured")
 * is an upstream-dependency failure from the caller's perspective.
 */
function mapErrorCode(message: string): string {
  void message; // reserved for finer-grained mapping if needed later
  return "upstream_unavailable";
}
