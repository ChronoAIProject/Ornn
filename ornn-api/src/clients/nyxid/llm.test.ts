/**
 * Tests for #574: NyxLlmClient must dispatch on the resolved
 * provider's `apiFormat` — `responses` hits `/responses` with native
 * body, `chat-completion` hits `/chat/completions` with translated
 * body and normalizes text deltas back into Responses-API event shape.
 *
 * Tool-call delta normalization for chat-completion is out of scope here
 * (tracked in #608).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  NyxLlmClient,
  type LlmProviderResolution,
  type ResponsesApiStreamEvent,
} from "./llm";
import type { NyxidSaTokenProvider } from "./base";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const STUB_SA_TOKEN: NyxidSaTokenProvider = {
  getAccessToken: async () => "sa-token-xyz",
} as unknown as NyxidSaTokenProvider;

function makeResolver(resolution: LlmProviderResolution) {
  return async () => resolution;
}

/** Build an SSE Response body from a sequence of `data:` payloads. */
function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

const originalFetch = globalThis.fetch;
let capturedRequests: CapturedRequest[];
let fetchHandler: (req: Request) => Promise<Response> | Response;

beforeEach(() => {
  capturedRequests = [];
  fetchHandler = () => new Response("no handler set", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const rawBody = init?.body;
    let parsedBody: unknown = rawBody;
    if (typeof rawBody === "string") {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        /* leave as string */
      }
    }
    const headers: Record<string, string> = {};
    const initHeaders = init?.headers;
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) headers[k] = v;
    } else if (initHeaders && typeof initHeaders === "object") {
      Object.assign(headers, initHeaders);
    }
    capturedRequests.push({ url, method, body: parsedBody, headers });
    const req = new Request(url, init);
    return fetchHandler(req);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// stream() — endpoint + body dispatch
// ---------------------------------------------------------------------------

describe("NyxLlmClient.stream() routing on apiFormat", () => {
  it("apiFormat=responses → POST /responses with native body", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({ type: "response.output_text.delta", delta: "hello" }),
      ]);

    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://gateway.example.com",
        apiKey: "sk-direct",
        apiFormat: "responses",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "gpt-test",
      input: [{ role: "user", content: "hi" }],
      instructions: "be brief",
    })) events.push(e);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.url).toBe("https://gateway.example.com/responses");
    expect(capturedRequests[0]!.method).toBe("POST");
    expect(capturedRequests[0]!.headers["Authorization"]).toBe("Bearer sk-direct");
    expect(capturedRequests[0]!.body).toMatchObject({
      model: "gpt-test",
      input: [{ role: "user", content: "hi" }],
      instructions: "be brief",
      stream: true,
      store: false,
    });
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "hello" },
    ]);
  });

  it("apiFormat=chat-completion → POST /chat/completions with translated body", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "Hel" } }] }),
        JSON.stringify({ choices: [{ delta: { content: "lo" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      ]);

    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.deepseek.com/",
        apiKey: "sk-deepseek",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "deepseek-v4-flash",
      input: [
        { role: "developer", content: "you are helpful" },
        { role: "user", content: "summarize" },
      ],
      instructions: "respond in english",
      max_output_tokens: 256,
      temperature: 0.3,
    })) events.push(e);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(capturedRequests[0]!.body).toMatchObject({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "respond in english" },
        { role: "system", content: "you are helpful" },
        { role: "user", content: "summarize" },
      ],
      max_tokens: 256,
      temperature: 0.3,
      stream: true,
    });
    // No `input` / `max_output_tokens` should leak into chat-completion body.
    expect((capturedRequests[0]!.body as Record<string, unknown>).input).toBeUndefined();
    expect((capturedRequests[0]!.body as Record<string, unknown>).max_output_tokens).toBeUndefined();

    // Text deltas normalized into Responses-API shape.
    expect(events).toEqual([
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
    ]);
  });

  it("chat-completion translates tools array into OpenAI function-tool shape", async () => {
    fetchHandler = () => sseResponse([]);
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
      tools: [
        {
          type: "function",
          name: "do_thing",
          description: "does the thing",
          parameters: { type: "object", properties: { x: { type: "string" } } },
        },
      ],
    })) events.push(e);

    expect((capturedRequests[0]!.body as Record<string, unknown>).tools).toEqual([
      {
        type: "function",
        function: {
          name: "do_thing",
          description: "does the thing",
          parameters: { type: "object", properties: { x: { type: "string" } } },
        },
      },
    ]);
  });

  it("flattens Responses-API content parts into a string for chat-completion", async () => {
    fetchHandler = () => sseResponse([]);
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "m",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "part 1 " },
            { type: "input_text", text: "part 2" },
          ],
        },
      ],
    })) events.push(e);

    const body = capturedRequests[0]!.body as { messages: Array<{ role: string; content: string }> };
    expect(body.messages).toEqual([{ role: "user", content: "part 1 part 2" }]);
  });

  it("trims trailing slash from gatewayUrl for both formats", async () => {
    fetchHandler = () => sseResponse([]);
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com///",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });
    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "m",
      input: [{ role: "user", content: "x" }],
    })) events.push(e);
    expect(capturedRequests[0]!.url).toBe("https://api.example.com/chat/completions");
  });

  it("falls back to SA token when resolved apiKey is empty", async () => {
    fetchHandler = () => sseResponse([]);
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });
    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of client.stream({
      model: "m",
      input: [{ role: "user", content: "x" }],
    })) events.push(e);
    expect(capturedRequests[0]!.headers["Authorization"]).toBe("Bearer sa-token-xyz");
  });

  it("fails closed when gatewayUrl is empty (no provider configured)", async () => {
    const client = new NyxLlmClient({
      resolver: makeResolver({ gatewayUrl: "", apiKey: "", apiFormat: "responses" }),
      saTokenProvider: STUB_SA_TOKEN,
    });
    await expect(async () => {
      for await (const _e of client.stream({
        model: "m",
        input: [{ role: "user", content: "x" }],
      })) {
        /* drain */
      }
    }).toThrow(/LLM_PROVIDER_NOT_CONFIGURED/);
    expect(capturedRequests).toHaveLength(0);
  });

  it("surfaces upstream non-2xx as sanitized error", async () => {
    fetchHandler = () =>
      new Response("Not Found: /responses", { status: 404 });
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "responses",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });
    await expect(async () => {
      for await (const _e of client.stream({
        model: "m",
        input: [{ role: "user", content: "x" }],
      })) {
        /* drain */
      }
    }).toThrow(/LLM Gateway error \(404\)/);
  });
});

// ---------------------------------------------------------------------------
// complete() — endpoint + body dispatch
// ---------------------------------------------------------------------------

describe("NyxLlmClient.complete() routing on apiFormat", () => {
  it("apiFormat=responses → POST /responses, returns output[]", async () => {
    fetchHandler = () =>
      jsonResponse({
        output: [{ type: "message", content: [{ type: "output_text", text: "hi" }] }],
      });

    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "responses",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const out = await client.complete({
      model: "m",
      input: [{ role: "user", content: "ping" }],
    });
    expect(capturedRequests[0]!.url).toBe("https://api.example.com/responses");
    expect((capturedRequests[0]!.body as Record<string, unknown>).stream).toBe(false);
    expect(out).toEqual([
      { type: "message", content: [{ type: "output_text", text: "hi" }] },
    ]);
  });

  it("apiFormat=chat-completion → POST /chat/completions, normalizes to ResponsesApiOutput[]", async () => {
    fetchHandler = () =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: "hello world" } }],
      });

    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });

    const out = await client.complete({
      model: "m",
      input: [{ role: "user", content: "say hi" }],
    });
    expect(capturedRequests[0]!.url).toBe("https://api.example.com/chat/completions");
    expect((capturedRequests[0]!.body as Record<string, unknown>).stream).toBe(false);
    expect(out).toEqual([
      { type: "message", content: [{ type: "output_text", text: "hello world" }] },
    ]);
  });

  it("returns [] when chat-completion response has empty content", async () => {
    fetchHandler = () =>
      jsonResponse({ choices: [{ message: { role: "assistant", content: "" } }] });
    const client = new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });
    const out = await client.complete({
      model: "m",
      input: [{ role: "user", content: "say nothing" }],
    });
    expect(out).toEqual([]);
  });
});
