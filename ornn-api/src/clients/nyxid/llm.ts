/**
 * HTTP client for Nyx Provider LLM Gateway (Responses API format).
 * All LLM calls (skill generation + playground chat) go through this client.
 * Authenticates using a Service Account (SA) token obtained via client_credentials grant.
 * @module clients/nyxid/llm
 */

import { createLogger } from "../../shared/logger";
import type { NyxidSaTokenProvider } from "./base";

const logger = createLogger("nyxLlmClient");

// ---------------------------------------------------------------------------
// Types
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

// ---------------------------------------------------------------------------
// SSE Parser
// ---------------------------------------------------------------------------

async function* parseSSEStream(
  response: Response,
): AsyncIterable<ResponsesApiStreamEvent> {
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
          if (data === "[DONE]") return;
          if (!data) continue;

          try {
            const event = JSON.parse(data) as ResponsesApiStreamEvent;
            yield event;
          } catch {
            logger.debug({ data: data.slice(0, 100) }, "Failed to parse SSE event");
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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
 * union into the simpler {gatewayUrl, apiKey?} shape this client
 * speaks.
 *
 * - `gatewayUrl` is required (validated upstream when the admin saves
 *   the provider) — empty string means "no provider configured" and
 *   the call MUST fail-closed; we don't keep an env fallback because
 *   any silent fallback masks misconfiguration.
 * - `apiKey` empty triggers the SA token-exchange path
 *   (`NyxidSaTokenProvider`). Most providers behind the NyxID proxy
 *   use SA flow; direct-key providers (third-party gateways) bypass it.
 */
export interface LlmProviderResolution {
  gatewayUrl: string;
  apiKey: string;
}

export type LlmProviderResolver = () => Promise<LlmProviderResolution>;

export interface NyxLlmClientConfig {
  /**
   * Resolves the effective gateway URL + apiKey for every LLM call from
   * admin settings. NO env fallback: if the resolver returns an empty
   * `gatewayUrl`, the call fails-closed with `LLM_PROVIDER_NOT_CONFIGURED`.
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
   * Resolve the effective gateway URL + auth header for the current
   * call. Pulls the provider config from settings; SA token is fetched
   * on demand when the provider has no direct apiKey.
   *
   * Fails-closed when no provider is configured — callers see a
   * structured error rather than a stale env URL.
   */
  private async resolveCallTarget(): Promise<{
    gatewayUrl: string;
    authHeader: string;
  }> {
    const provider = await this.resolver();
    const gatewayUrl = provider.gatewayUrl?.trim().replace(/\/+$/, "");
    if (!gatewayUrl) {
      throw new Error("LLM_PROVIDER_NOT_CONFIGURED: no gatewayUrl in settings");
    }

    if (provider.apiKey && provider.apiKey.trim().length > 0) {
      return { gatewayUrl, authHeader: `Bearer ${provider.apiKey.trim()}` };
    }

    const token = await this.saTokenProvider.getAccessToken();
    return { gatewayUrl, authHeader: `Bearer ${token}` };
  }

  /**
   * Streaming LLM call using Responses API format.
   * Returns an AsyncIterable of SSE events.
   */
  async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
    const { gatewayUrl, authHeader } = await this.resolveCallTarget();
    logger.info({ model: params.model, gatewayUrl }, "Starting LLM stream request");

    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input,
      max_output_tokens: params.max_output_tokens ?? 8192,
      temperature: params.temperature ?? 0.7,
      stream: true,
      store: false,
    };

    if (params.instructions) {
      body.instructions = params.instructions;
    }
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
    }

    const response = await fetch(`${gatewayUrl}/responses`, {
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
      logger.error({ status: response.status, model: params.model }, message);
      throw new Error(message);
    }

    let eventCount = 0;
    for await (const event of parseSSEStream(response)) {
      eventCount++;
      yield event;
    }
    logger.info({ totalEvents: eventCount, model: params.model }, "LLM stream completed");
  }

  /**
   * Non-streaming LLM call using Responses API format.
   * Returns the output array from the response.
   */
  async complete(params: NyxLlmCompleteParams): Promise<ResponsesApiOutput[]> {
    const { gatewayUrl, authHeader } = await this.resolveCallTarget();
    logger.info({ model: params.model, gatewayUrl }, "Starting LLM complete request");

    const body: Record<string, unknown> = {
      model: params.model,
      input: params.input,
      max_output_tokens: params.max_output_tokens ?? 8192,
      temperature: params.temperature ?? 0.7,
      stream: false,
      store: false,
    };

    if (params.instructions) {
      body.instructions = params.instructions;
    }
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
    }

    const response = await fetch(`${gatewayUrl}/responses`, {
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
      logger.error({ status: response.status, model: params.model }, message);
      throw new Error(message);
    }

    const result = (await response.json()) as { output: ResponsesApiOutput[] };
    return result.output ?? [];
  }
}
