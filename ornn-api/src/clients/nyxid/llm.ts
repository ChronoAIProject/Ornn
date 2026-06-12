/**
 * HTTP client for the Nyx Provider LLM Gateway.
 *
 * Dispatches to one of two upstream API formats per call based on the
 * resolved provider's `apiFormat`:
 *
 * - `responses`        → `{gatewayUrl}/responses`        (native shape)
 * - `chat-completion`  → `{gatewayUrl}/chat/completions` (OpenAI-style)
 *
 * Callers always speak Responses-API shapes (input messages, tools,
 * `ResponsesApiStreamEvent`). For chat-completion providers the client
 * translates the request body on the way out and normalizes the SSE
 * stream / completion payload back into Responses-API event shape on
 * the way in, so consumers (skill generation + playground) do not need
 * to branch on apiFormat (#574).
 *
 * Chat-completion tool-call normalization is implemented: streamed
 * `choices[].delta.tool_calls[]` fragments are accumulated and flushed
 * as `response.output_item.done` function_call events, and non-streamed
 * `choices[].message.tool_calls[]` map to `function_call` outputs (#608).
 *
 * Authenticates using a Service Account (SA) token obtained via
 * client_credentials grant when the resolved provider has no direct
 * apiKey.
 *
 * @module clients/nyxid/llm
 */

import { createLogger } from "../../shared/logger";
import { safeFetch } from "../../infra/safeFetch";
import type { ApiFormat } from "../../domains/settings/llmProviders/types";
import type { NyxidSaTokenProvider } from "./base";

const logger = createLogger("nyxLlmClient");

// ---------------------------------------------------------------------------
// Types — caller-facing (Responses-API shape, format-agnostic)
// ---------------------------------------------------------------------------

export interface ResponsesApiInputMessage {
  role: "user" | "assistant" | "developer";
  content: string | ResponsesApiContentPart[];
}

export type ResponsesApiContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string };

export interface ResponsesApiTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ResponsesApiStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ResponsesApiOutput {
  type: "message" | "function_call";
  id?: string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  call_id?: string;
  arguments?: string;
}

export interface NyxLlmStreamParams {
  model: string;
  input: ResponsesApiInputMessage[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  tools?: ResponsesApiTool[];
}

export interface NyxLlmCompleteParams {
  model: string;
  input: ResponsesApiInputMessage[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  tools?: ResponsesApiTool[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip HTML from upstream error responses (e.g. Cloudflare 502 pages). */
function sanitizeErrorResponse(status: number, rawText: string): string {
  // Try JSON first
  try {
    const json = JSON.parse(rawText);
    if (json.error?.message) return `LLM Gateway error (${status}): ${json.error.message}`;
    if (typeof json.message === "string") return `LLM Gateway error (${status}): ${json.message}`;
  } catch { /* not JSON */ }

  // If it looks like HTML, return a clean message
  if (rawText.includes("<!DOCTYPE") || rawText.includes("<html")) {
    const statusMessages: Record<number, string> = {
      502: "Bad Gateway — upstream LLM service is temporarily unavailable",
      503: "Service Unavailable — upstream LLM service is temporarily unavailable",
      504: "Gateway Timeout — upstream LLM service did not respond in time",
      429: "Rate limited — too many requests to LLM service",
    };
    return `LLM Gateway error (${status}): ${statusMessages[status] ?? "upstream service error"}`;
  }

  // Plain text — truncate if too long
  const truncated = rawText.length > 200 ? rawText.slice(0, 200) + "..." : rawText;
  return `LLM Gateway error (${status}): ${truncated}`;
}

/**
 * Flatten a Responses-API content union into a single string for
 * Chat Completions, which accepts string content for most roles.
 * Preserves text order; non-text parts are dropped (no Responses-API
 * non-text parts are produced by callers today).
 */
function flattenContentToString(
  content: string | ResponsesApiContentPart[],
): string {
  if (typeof content === "string") return content;
  return content.map((p) => p.text).join("");
}

/** Responses-API `developer` role maps to Chat Completions `system`. */
function mapRoleToChatCompletion(
  role: ResponsesApiInputMessage["role"],
): "user" | "assistant" | "system" {
  return role === "developer" ? "system" : role;
}

// ---------------------------------------------------------------------------
// SSE Parser (shared across both formats)
// ---------------------------------------------------------------------------

interface RawSseEvent {
  data: string;
}

async function* parseSSELines(response: Response): AsyncIterable<RawSseEvent> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (!data) continue;
          yield { data };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse Responses-API SSE: each `data:` is a JSON event object. */
async function* parseResponsesStream(
  response: Response,
): AsyncIterable<ResponsesApiStreamEvent> {
  for await (const { data } of parseSSELines(response)) {
    if (data === "[DONE]") return;
    try {
      yield JSON.parse(data) as ResponsesApiStreamEvent;
    } catch {
      logger.debug({ data: data.slice(0, 100) }, "Failed to parse SSE event");
    }
  }
}

/**
 * Parse Chat Completions SSE and translate both text deltas and
 * tool-call deltas into Responses-API event shape so consumers stay
 * format-agnostic.
 *
 * Text deltas (`choices[].delta.content`) pass through as
 * `response.output_text.delta`. Tool-call fragments
 * (`choices[].delta.tool_calls[]`) arrive incrementally — `id`/`name`
 * land on the first fragment, `function.arguments` streams across many
 * — so we accumulate per `index` and flush each completed call as a
 * single `response.output_item.done` function_call event (matching the
 * Responses-API shape the playground consumer reads). We never parse the
 * arguments mid-stream; the consumer parses the assembled JSON (#608).
 */
async function* parseChatCompletionStream(
  response: Response,
): AsyncIterable<ResponsesApiStreamEvent> {
  const toolCalls = new Map<number, { id: string; name: string; argsBuffer: string }>();
  let flushed = false;

  function* flush(): Generator<ResponsesApiStreamEvent> {
    if (flushed) return;
    flushed = true;
    for (const index of [...toolCalls.keys()].sort((a, b) => a - b)) {
      const call = toolCalls.get(index)!;
      yield {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: call.id,
          call_id: call.id,
          name: call.name,
          arguments: call.argsBuffer,
        },
      };
    }
  }

  for await (const { data } of parseSSELines(response)) {
    if (data === "[DONE]") break;
    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
    };
    try {
      chunk = JSON.parse(data);
    } catch {
      logger.debug({ data: data.slice(0, 100) }, "Failed to parse chat-completion chunk");
      continue;
    }

    const choice = chunk.choices?.[0];
    const textDelta = choice?.delta?.content;
    if (typeof textDelta === "string" && textDelta.length > 0) {
      yield { type: "response.output_text.delta", delta: textDelta };
    }

    const fragments = choice?.delta?.tool_calls;
    if (fragments) {
      for (const frag of fragments) {
        const existing = toolCalls.get(frag.index) ?? { id: "", name: "", argsBuffer: "" };
        if (frag.id) existing.id = frag.id;
        if (frag.function?.name) existing.name = frag.function.name;
        if (typeof frag.function?.arguments === "string") {
          existing.argsBuffer += frag.function.arguments;
        }
        toolCalls.set(frag.index, existing);
      }
    }

    if (choice?.finish_reason === "tool_calls") {
      yield* flush();
    }
  }

  // Flush on stream end / [DONE] in case the upstream omitted the
  // `finish_reason: "tool_calls"` chunk but still streamed tool calls.
  if (toolCalls.size > 0) {
    yield* flush();
  }
}

// ---------------------------------------------------------------------------
// Request body builders
// ---------------------------------------------------------------------------

function buildResponsesBody(
  params: NyxLlmStreamParams | NyxLlmCompleteParams,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    input: params.input,
    max_output_tokens: params.max_output_tokens ?? 8192,
    temperature: params.temperature ?? 0.7,
    stream,
    store: false,
  };
  if (params.instructions) body.instructions = params.instructions;
  if (params.tools && params.tools.length > 0) body.tools = params.tools;
  return body;
}

function buildChatCompletionBody(
  params: NyxLlmStreamParams | NyxLlmCompleteParams,
  stream: boolean,
): Record<string, unknown> {
  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  if (params.instructions) {
    messages.push({ role: "system", content: params.instructions });
  }
  for (const m of params.input) {
    messages.push({
      role: mapRoleToChatCompletion(m.role),
      content: flattenContentToString(m.content),
    });
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    max_tokens: params.max_output_tokens ?? 8192,
    temperature: params.temperature ?? 0.7,
    stream,
  };
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    body.tool_choice = "auto";
  }
  return body;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Per-call provider config. Resolved on every LLM request from the
 * `LlmProvidersService` (a wrapper around the `llm_providers`
 * collection) so an admin's edit lands on the next call without a pod
 * restart. The resolver chooses the right provider for the surface
 * (playground vs skill-gen) and projects its `auth` discriminated
 * union into the simpler {gatewayUrl, apiKey?, apiFormat} shape this
 * client speaks.
 *
 * - `gatewayUrl` is required (validated upstream when the admin saves
 *   the provider) — empty string means "no provider configured" and
 *   the call MUST fail-closed; we don't keep an env fallback because
 *   any silent fallback masks misconfiguration.
 * - `apiKey` empty triggers the SA token-exchange path
 *   (`NyxidSaTokenProvider`). Most providers behind the NyxID proxy
 *   use SA flow; direct-key providers (third-party gateways) bypass it.
 * - `apiFormat` selects the upstream endpoint + body shape (#574). Empty
 *   gateway short-circuits before this matters; otherwise defaults to
 *   `responses` for backward compatibility if the resolver omits it.
 */
export interface LlmProviderResolution {
  gatewayUrl: string;
  apiKey: string;
  apiFormat: ApiFormat;
}

export type LlmProviderResolver = () => Promise<LlmProviderResolution>;

export interface NyxLlmClientConfig {
  /**
   * Resolves the effective gateway URL + apiKey + apiFormat for every
   * LLM call from admin settings. NO env fallback: if the resolver
   * returns an empty `gatewayUrl`, the call fails-closed with
   * `LLM_PROVIDER_NOT_CONFIGURED`.
   */
  resolver: LlmProviderResolver;
  /**
   * Shared SA token provider used when the resolved provider has no
   * direct apiKey (i.e. it sits behind the NyxID proxy and authorizes
   * via OAuth client_credentials). Owned by bootstrap so all clients
   * share one token cache.
   */
  saTokenProvider: NyxidSaTokenProvider;
}

export class NyxLlmClient {
  private readonly resolver: LlmProviderResolver;
  private readonly saTokenProvider: NyxidSaTokenProvider;

  constructor(config: NyxLlmClientConfig) {
    this.resolver = config.resolver;
    this.saTokenProvider = config.saTokenProvider;
    logger.info("NyxLlmClient initialized with settings-driven resolver");
  }

  /**
   * Resolve the effective gateway URL + auth header + apiFormat for the
   * current call. Pulls the provider config from settings; SA token is
   * fetched on demand when the provider has no direct apiKey.
   *
   * Fails-closed when no provider is configured — callers see a
   * structured error rather than a stale env URL.
   */
  private async resolveCallTarget(): Promise<{
    gatewayUrl: string;
    authHeader: string;
    apiFormat: ApiFormat;
  }> {
    const provider = await this.resolver();
    const gatewayUrl = provider.gatewayUrl?.trim().replace(/\/+$/, "");
    if (!gatewayUrl) {
      throw new Error("LLM_PROVIDER_NOT_CONFIGURED: no gatewayUrl in settings");
    }
    const apiFormat: ApiFormat = provider.apiFormat ?? "responses";

    if (provider.apiKey && provider.apiKey.trim().length > 0) {
      return { gatewayUrl, authHeader: `Bearer ${provider.apiKey.trim()}`, apiFormat };
    }

    const token = await this.saTokenProvider.getAccessToken();
    return { gatewayUrl, authHeader: `Bearer ${token}`, apiFormat };
  }

  /**
   * Streaming LLM call. Returns an AsyncIterable of Responses-API
   * shaped SSE events regardless of upstream format.
   */
  async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
    const { gatewayUrl, authHeader, apiFormat } = await this.resolveCallTarget();
    logger.info(
      { model: params.model, gatewayUrl, apiFormat },
      "Starting LLM stream request",
    );

    const path = apiFormat === "chat-completion" ? "/chat/completions" : "/responses";
    const body =
      apiFormat === "chat-completion"
        ? buildChatCompletionBody(params, true)
        : buildResponsesBody(params, true);

    const response = await safeFetch(`${gatewayUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const message = sanitizeErrorResponse(response.status, rawText);
      logger.error({ status: response.status, model: params.model, apiFormat }, message);
      throw new Error(message);
    }

    const parser =
      apiFormat === "chat-completion"
        ? parseChatCompletionStream(response)
        : parseResponsesStream(response);

    let eventCount = 0;
    for await (const event of parser) {
      eventCount++;
      yield event;
    }
    logger.info(
      { totalEvents: eventCount, model: params.model, apiFormat },
      "LLM stream completed",
    );
  }

  /**
   * Non-streaming LLM call. Returns Responses-API `ResponsesApiOutput[]`
   * regardless of upstream format.
   */
  async complete(params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
    const { gatewayUrl, authHeader, apiFormat } = await this.resolveCallTarget();
    logger.info(
      { model: params.model, gatewayUrl, apiFormat },
      "Starting LLM complete request",
    );

    const path = apiFormat === "chat-completion" ? "/chat/completions" : "/responses";
    const body =
      apiFormat === "chat-completion"
        ? buildChatCompletionBody(params, false)
        : buildResponsesBody(params, false);

    const response = await safeFetch(`${gatewayUrl}${path}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const message = sanitizeErrorResponse(response.status, rawText);
      logger.error({ status: response.status, model: params.model, apiFormat }, message);
      throw new Error(message);
    }

    if (apiFormat === "chat-completion") {
      const result = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const message = result.choices?.[0]?.message;
      const outputs: ResponsesApiOutput[] = [];

      const text = message?.content ?? "";
      if (text) {
        outputs.push({ type: "message", content: [{ type: "output_text", text }] });
      }

      for (const call of message?.tool_calls ?? []) {
        const id = call.id ?? "";
        const fnCall: ResponsesApiOutput = {
          type: "function_call",
          id,
          call_id: id,
          name: call.function?.name ?? "",
          arguments: call.function?.arguments ?? "",
        };
        outputs.push(fnCall);
      }

      return outputs;
    }

    const result = (await response.json()) as { output: ResponsesApiOutput[] };
    return result.output ?? [];
  }
}
