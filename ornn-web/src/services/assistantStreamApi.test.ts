/**
 * UT-WEB-ASSISTANT-STREAM-001 — assistantStreamApi transport (#970).
 *
 * Dedicated unit coverage for the SSE client (previously only exercised
 * indirectly through useAssistantChat). Asserts the four load-bearing
 * behaviors:
 *   1. POSTs to /api/v1/assistant/chat with the Bearer header + the
 *      {messages, modelId} body.
 *   2. Parses chat_* frames off the stream via the real sseParser and
 *      forwards them in arrival order.
 *   3. Maps a non-OK RFC 7807 problem+json response to a synthetic
 *      chat_error carrying detail + code.
 *   4. Wires the AbortController so handle.abort() cancels the request
 *      and the AbortError path stays silent (no spurious chat_error).
 *
 * The auth store is mocked (fresh token + Bearer); fetch is stubbed; the
 * sseParser + event schema are the real modules.
 *
 * @module services/assistantStreamApi.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AssistantChatEvent } from "@/types/assistant";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({
      ensureFreshToken: async () => {},
      accessToken: "test-token",
    }),
  },
}));

import { streamAssistantChat } from "./assistantStreamApi";

/** Build a fake streaming Response whose body yields the given SSE frames. */
function sseResponse(frames: string[]) {
  const enc = new TextEncoder();
  const chunks = frames.map((f) => enc.encode(f));
  let i = 0;
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      getReader: () => ({
        read: () =>
          i < chunks.length
            ? Promise.resolve({ done: false, value: chunks[i++] })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  };
}

/** Run a stream to a terminal event, collecting everything onEvent saw. */
function collect(
  params: Parameters<typeof streamAssistantChat>[0],
): Promise<AssistantChatEvent[]> {
  return new Promise((resolve) => {
    const events: AssistantChatEvent[] = [];
    streamAssistantChat(params, (e) => {
      events.push(e);
      if (e.type === "chat_finish" || e.type === "chat_error") resolve(events);
    });
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assistantStreamApi", () => {
  it("POSTs to /api/v1/assistant/chat with auth + body, parsing chat_* frames", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"chat_start","model":"gpt-5"}\n\n',
        'data: {"type":"chat_text_delta","delta":"Ornn"}\n\n',
        'data: {"type":"chat_finish","usage":{"totalTokens":5}}\n\n',
      ]),
    );

    const events = await collect({
      messages: [{ role: "user", content: "What is Ornn?" }],
      modelId: "gpt-5",
    });

    // Request shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/assistant\/chat$/);
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(opts.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(opts.body)).toEqual({
      messages: [{ role: "user", content: "What is Ornn?" }],
      modelId: "gpt-5",
    });

    // Frames parsed via sseParser, in order.
    expect(events.map((e) => e.type)).toEqual([
      "chat_start",
      "chat_text_delta",
      "chat_finish",
    ]);
    const delta = events[1];
    expect(delta.type === "chat_text_delta" && delta.delta).toBe("Ornn");
  });

  it("splits frames that arrive across chunk boundaries", async () => {
    // The delta frame is delivered in two reads — sseParser must buffer
    // the partial remainder until the terminating blank line lands.
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"chat_text_delta","del',
        'ta":"Hi"}\n\n',
        'data: {"type":"chat_finish"}\n\n',
      ]),
    );

    const events = await collect({ messages: [{ role: "user", content: "hi" }] });
    expect(events.map((e) => e.type)).toEqual(["chat_text_delta", "chat_finish"]);
    const delta = events[0];
    expect(delta.type === "chat_text_delta" && delta.delta).toBe("Hi");
  });

  it("maps a non-OK RFC 7807 response to a synthetic chat_error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => JSON.stringify({ detail: "Rate limited", code: "rate_limited" }),
    });

    const events = await collect({ messages: [{ role: "user", content: "hi" }] });
    expect(events).toEqual([
      { type: "chat_error", code: "rate_limited", message: "Rate limited" },
    ]);
  });

  it("honors AbortController cancel and stays silent on AbortError", async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const onEvent = vi.fn();
    const handle = streamAssistantChat(
      { messages: [{ role: "user", content: "hi" }] },
      onEvent,
    );

    // Let getAuthHeaders + fetch run so the signal is captured.
    await new Promise((r) => setTimeout(r, 0));
    expect(capturedSignal?.aborted).toBe(false);

    handle.abort();
    await new Promise((r) => setTimeout(r, 0));

    expect(capturedSignal?.aborted).toBe(true);
    // AbortError must not surface as a chat_error.
    expect(onEvent).not.toHaveBeenCalled();
  });
});
