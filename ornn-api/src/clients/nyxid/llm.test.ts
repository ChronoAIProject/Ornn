/**
 * Tests for #574: NyxLlmClient must dispatch on the resolved
 * provider's `apiFormat` — `responses` hits `/responses` with native
 * body, `chat-completion` hits `/chat/completions` with translated
 * body and normalizes text deltas back into Responses-API event shape.
 *
 * #608: chat-completion tool-call normalization — streamed
 * `delta.tool_calls[]` fragments accumulate into a single
 * `response.output_item.done` function_call event, and the request body
 * carries `tool_choice: "auto"` whenever tools are supplied.
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

  it("chat-completion sets tool_choice:auto when tools supplied", async () => {
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
          parameters: { type: "object", properties: {} },
        },
      ],
    })) events.push(e);

    expect((capturedRequests[0]!.body as Record<string, unknown>).tool_choice).toBe("auto");
  });

  it("chat-completion omits tool_choice when no tools supplied", async () => {
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
    })) events.push(e);

    expect((capturedRequests[0]!.body as Record<string, unknown>).tool_choice).toBeUndefined();
  });

  it("chat-completion accumulates streamed tool_calls into one output_item.done", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "execute_in_sandbox", arguments: '{"sc' },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'ript":"x"}' } }] } },
          ],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);

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
      input: [{ role: "user", content: "run it" }],
    })) events.push(e);

    const itemDone = events.filter((e) => e.type === "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect(itemDone[0]).toEqual({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call_1",
        call_id: "call_1",
        name: "execute_in_sandbox",
        arguments: '{"script":"x"}',
      },
    });
  });

  it("chat-completion still emits text deltas when interleaved with tool_calls", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "thinking " } }] }),
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_2",
                    function: { name: "execute_in_sandbox", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
        JSON.stringify({ choices: [{ delta: { content: "more" } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);

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
      input: [{ role: "user", content: "run it" }],
    })) events.push(e);

    const textDeltas = events.filter((e) => e.type === "response.output_text.delta");
    expect(textDeltas).toEqual([
      { type: "response.output_text.delta", delta: "thinking " },
      { type: "response.output_text.delta", delta: "more" },
    ]);
    const itemDone = events.filter((e) => e.type === "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect((itemDone[0]!.item as { call_id: string }).call_id).toBe("call_2");
  });

  it("chat-completion flushes accumulated tool_calls on stream end without finish_reason", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_3",
                    function: { name: "execute_in_sandbox", arguments: '{"a":1}' },
                  },
                ],
              },
            },
          ],
        }),
      ]);

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
      input: [{ role: "user", content: "run it" }],
    })) events.push(e);

    const itemDone = events.filter((e) => e.type === "response.output_item.done");
    expect(itemDone).toHaveLength(1);
    expect(itemDone[0]).toEqual({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call_3",
        call_id: "call_3",
        name: "execute_in_sandbox",
        arguments: '{"a":1}',
      },
    });
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

  it("chat-completion maps message.tool_calls to function_call outputs", async () => {
    fetchHandler = () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "calling tool",
              tool_calls: [
                {
                  id: "call_9",
                  function: { name: "execute_in_sandbox", arguments: '{"script":"x"}' },
                },
              ],
            },
          },
        ],
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
      input: [{ role: "user", content: "run it" }],
    });
    expect(out).toEqual([
      { type: "message", content: [{ type: "output_text", text: "calling tool" }] },
      {
        type: "function_call",
        id: "call_9",
        call_id: "call_9",
        name: "execute_in_sandbox",
        arguments: '{"script":"x"}',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// #608 — chat-completion tool-call delta normalization
// ---------------------------------------------------------------------------

describe("chat-completion stream tool-call normalization (#608)", () => {
  function makeClient(): NyxLlmClient {
    return new NyxLlmClient({
      resolver: makeResolver({
        gatewayUrl: "https://api.example.com",
        apiKey: "sk-x",
        apiFormat: "chat-completion",
      }),
      saTokenProvider: STUB_SA_TOKEN,
    });
  }

  it("accumulates tool_calls across chunks and emits one output_item.done on finish_reason=tool_calls", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_abc",
                type: "function",
                function: { name: "execute_in_sandbox", arguments: "" },
              }],
            },
          }],
        }),
        JSON.stringify({
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: "{\"scr" } }] },
          }],
        }),
        JSON.stringify({
          choices: [{
            delta: { tool_calls: [{ index: 0, function: { arguments: "ipt\":\"x\"}" } }] },
          }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "deepseek-v4",
      input: [{ role: "user", content: "run x" }],
      tools: [{
        type: "function",
        name: "execute_in_sandbox",
        description: "run",
        parameters: { type: "object" },
      }],
    })) events.push(e);

    const done = events.filter((e) => e.type === "response.output_item.done");
    expect(done).toHaveLength(1);
    expect(done[0]).toEqual({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call_abc",
        call_id: "call_abc",
        name: "execute_in_sandbox",
        arguments: "{\"script\":\"x\"}",
      },
    });
  });

  it("flushes a buffered tool call when stream ends without [DONE] or finish_reason", async () => {
    // Body has no [DONE] sentinel and no finish_reason — just an EOF.
    fetchHandler = () =>
      new Response(
        `data: ${JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_z",
                function: { name: "t", arguments: "{\"a\":1}" },
              }],
            },
          }],
        })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
    })) events.push(e);

    const done = events.find((e) => e.type === "response.output_item.done");
    expect(done).toEqual({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        id: "call_z",
        call_id: "call_z",
        name: "t",
        arguments: "{\"a\":1}",
      },
    });
  });

  it("supports parallel tool calls — one done event per index", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", function: { name: "fn_a", arguments: "{}" } },
                { index: 1, id: "call_b", function: { name: "fn_b", arguments: "{}" } },
              ],
            },
          }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
    })) events.push(e);

    const done = events.filter((e) => e.type === "response.output_item.done");
    expect(done).toHaveLength(2);
    expect((done[0]!.item as { id: string }).id).toBe("call_a");
    expect((done[1]!.item as { id: string }).id).toBe("call_b");
  });

  it("only flushes once when finish_reason and [DONE] both arrive", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_x", function: { name: "fn", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          }],
        }),
      ]);

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
    })) events.push(e);

    const done = events.filter((e) => e.type === "response.output_item.done");
    expect(done).toHaveLength(1);
  });

  it("intermixed text + tool_call deltas produce text-delta then done event in order", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({ choices: [{ delta: { content: "thinking…" } }] }),
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{ index: 0, id: "call_q", function: { name: "fn", arguments: "{}" } }],
            },
          }],
        }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      ]);

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
    })) events.push(e);

    expect(events.map((e) => e.type)).toEqual([
      "response.output_text.delta",
      "response.output_item.done",
    ]);
  });

  it("tool_calls.index missing → falls back to index 0", async () => {
    fetchHandler = () =>
      sseResponse([
        JSON.stringify({
          choices: [{
            delta: {
              tool_calls: [{ id: "call_noix", function: { name: "fn", arguments: "{}" } }],
            },
            finish_reason: "tool_calls",
          }],
        }),
      ]);

    const events: ResponsesApiStreamEvent[] = [];
    for await (const e of makeClient().stream({
      model: "m",
      input: [{ role: "user", content: "go" }],
    })) events.push(e);

    const done = events.find((e) => e.type === "response.output_item.done");
    expect((done?.item as { id: string }).id).toBe("call_noix");
  });
});
