/**
 * HTTP client for Nyx Provider LLM Gateway (Responses API format).
 * All LLM calls (skill generation + playground chat) go through this client.
 * Authenticates using a Service Account (SA) token obtained via client_credentials grant.
 * @module clients/nyxLlmClient
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxLlmClient" });

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
// SA Token Cache
// ---------------------------------------------------------------------------

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
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

export interface NyxLlmClientConfig {
  gatewayUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
}

export class NyxLlmClient {
  private readonly gatewayUrl: string;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private cachedToken: CachedToken | null = null;

  constructor(config: NyxLlmClientConfig) {
    this.gatewayUrl = config.gatewayUrl;
    this.tokenUrl = config.tokenUrl;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    logger.info({ gatewayUrl: config.gatewayUrl, tokenUrl: config.tokenUrl }, "NyxLlmClient initialized with SA credentials");
  }

  /**
   * Get a valid SA access token, refreshing if expired or about to expire.
   * Caches the token and refreshes 60s before expiry.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Return cached token if still valid (with 60s buffer)
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) {
      return this.cachedToken.accessToken;
    }

    logger.info("Acquiring new SA access token via client_credentials grant");

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      const msg = `SA token acquisition failed (${response.status}): ${errText.slice(0, 200)}`;
      logger.error({ status: response.status }, msg);
      throw new Error(msg);
    }

    const result = (await response.json()) as {
      access_token: string;
      expires_in?: number;
      token_type?: string;
    };

    if (!result.access_token) {
      throw new Error("SA token response missing access_token");
    }

    const expiresInMs = (result.expires_in ?? 900) * 1000;
    this.cachedToken = {
      accessToken: result.access_token,
      expiresAt: now + expiresInMs,
    };

    logger.info({ expiresInSecs: result.expires_in ?? 900 }, "SA access token acquired");
    return this.cachedToken.accessToken;
  }

  /**
   * Streaming LLM call using Responses API format.
   * Returns an AsyncIterable of SSE events.
   */
  async *stream(params: NyxLlmStreamParams): AsyncIterable<ResponsesApiStreamEvent> {
    const token = await this.getAccessToken();
    logger.info({ model: params.model }, "Starting LLM stream request");

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

    const response = await fetch(`${this.gatewayUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
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
    const token = await this.getAccessToken();
    logger.info({ model: params.model }, "Starting LLM complete request");

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

    const response = await fetch(`${this.gatewayUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
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
