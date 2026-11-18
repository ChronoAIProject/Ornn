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
 * the way in — both text deltas (#574) and accumulated tool-call
 * deltas synthesized into `response.output_item.done` /
 * `function_call` events (#608) — so consumers (skill generation +
 * playground tool loop) never branch on apiFormat.
 *
 * Authenticates using a Service Account (SA) token obtained via
 * client_credentials grant when the resolved provider has no direct
 * apiKey.
 *
 * @module clients/nyxid/llm
 */

import { createLogger } from "../../shared/logger";
import { parseResponsesStream, parseChatCompletionStream } from "./llmStream";
import { requestWithSaToken, type SaTokenSource } from "./saRequest";
import { safeFetch } from "../../infra/safeFetch";
import type { ApiFormat } from "../../domains/settings/llmProviders/types";

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
  if (status === 401 || status === 403) return `LLM Gateway error (${status}): authentication rejected`;
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
  saTokenProvider: SaTokenSource;
}

export class NyxLlmClient {
  private readonly resolver: LlmProviderResolver;
  private readonly saTokenProvider: SaTokenSource;

  constructor(config: NyxLlmClientConfig) {
    this.resolver = config.resolver;
    this.saTokenProvider = config.saTokenProvider;
    logger.info("NyxLlmClient initialized with settings-driven resolver");
  }

  private async request(
    params: NyxLlmStreamParams | NyxLlmCompleteParams,
    stream: boolean,
  ): Promise<{ response: Response; apiFormat: ApiFormat }> {
    let provider = await this.resolver();
    let apiFormat: ApiFormat = provider.apiFormat ?? "responses";
    const send = async (token: string) => {
      const gatewayUrl = provider.gatewayUrl?.trim().replace(/\/+$/, "");
      if (!gatewayUrl) {
        throw new Error("LLM_PROVIDER_NOT_CONFIGURED: no gatewayUrl in settings");
      }
      apiFormat = provider.apiFormat ?? "responses";
      const path = apiFormat === "chat-completion" ? "/chat/completions" : "/responses";
      const body = apiFormat === "chat-completion"
        ? buildChatCompletionBody(params, stream)
        : buildResponsesBody(params, stream);
      return safeFetch(`${gatewayUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };
    if (!provider.gatewayUrl?.trim()) {
      throw new Error("LLM_PROVIDER_NOT_CONFIGURED: no gatewayUrl in settings");
    }
    logger.info({ model: params.model, stream }, "Starting LLM request");
    // Direct provider credentials are never replaced with platform credentials.
    const directKey = provider.apiKey?.trim();
    const response = directKey ? await send(directKey) : await requestWithSaToken(
      this.saTokenProvider,
      async (token) => {
        provider = await this.resolver();
        if (provider.apiKey?.trim()) {
          throw new Error("LLM authentication mode changed during request");
        }
        return send(token);
      },
    );
    return { response, apiFormat };
  }

  /**
   * Streaming LLM call. Returns an AsyncIterable of Responses-API
   * shaped SSE events regardless of upstream format.
   */
  async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
    const { response, apiFormat } = await this.request(params, true);

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
    const { response, apiFormat } = await this.request(params, false);

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
