/**
 * UT-WEB-GENERATE-STREAM-001 (#1242)
 *
 * First tests for the skill-generation SSE client. `fetch` is stubbed
 * with a fake streaming Response whose reader yields encoded SSE
 * frames; the real `sseParser` is used. Pins the exact JSON body the
 * client posts, the event whitelist, abort, and the pre-stream failure
 * path (RFC 7807 `detail` surfaces as the error message).
 *
 * @module services/generateStreamApi.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GenerationStreamEvent } from "@/types/streaming";

vi.mock("@/stores/authStore", () => ({
  useAuthStore: {
    getState: () => ({ accessToken: "test-token" }),
  },
}));

import { generateSkillStream } from "./generateStreamApi";

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

/** A rejected-before-stream response carrying a problem+json body. */
function problemResponse(status: number, statusText: string, body: unknown) {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/** Run a stream to a terminal event, collecting everything onEvent saw. */
function collect(
  params: Parameters<typeof generateSkillStream>[0],
): Promise<GenerationStreamEvent[]> {
  return new Promise((resolve) => {
    const events: GenerationStreamEvent[] = [];
    generateSkillStream(params, (e) => {
      events.push(e);
      if (e.type === "generation_complete" || e.type === "error") resolve(events);
    });
  });
}

const fetchMock = vi.fn();
const MESSAGES = [{ role: "user", content: "build a thing" }];

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateSkillStream", () => {
  it("POSTs to /api/v1/skills/generate with bearer auth and the messages + modelId body", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"generation_complete","raw":"{}"}\n\n']),
    );
    await collect({ messages: MESSAGES, modelId: "m-1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain("/api/v1/skills/generate");
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(opts.body as string)).toEqual({ messages: MESSAGES, modelId: "m-1" });
  });

  it("threads mode into the body (#1242)", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"generation_complete","raw":"{}"}\n\n']),
    );
    await collect({ messages: MESSAGES, modelId: "m-1", mode: "simple" });
    const [, opts] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({
      messages: MESSAGES,
      modelId: "m-1",
      mode: "simple",
    });
  });

  it("omits modelId and mode from the body when not set", async () => {
    fetchMock.mockResolvedValue(
      sseResponse(['data: {"type":"generation_complete","raw":"{}"}\n\n']),
    );
    await collect({ messages: MESSAGES });
    const [, opts] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ messages: MESSAGES });
  });

  it("forwards every known event type in order and drops unknown frames", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([
        'data: {"type":"generation_start"}\n\n',
        'data: {"type":"token","content":"{\\"na"}\n\n',
        'data: {"type":"mystery"}\n\n',
        'data: {"type":"validation_error","message":"m","retrying":true}\n\n',
        'data: {"type":"generation_complete","raw":"{\\"name\\":\\"x\\"}"}\n\n',
      ]),
    );
    const events = await collect({ messages: MESSAGES });
    expect(events.map((e) => e.type)).toEqual([
      "generation_start",
      "token",
      "validation_error",
      "generation_complete",
    ]);
  });

  it("handles frames split across chunks", async () => {
    const frame = 'data: {"type":"generation_complete","raw":"abc"}\n\n';
    fetchMock.mockResolvedValue(sseResponse([frame.slice(0, 15), frame.slice(15)]));
    const events = await collect({ messages: MESSAGES });
    expect(events).toEqual([{ type: "generation_complete", raw: "abc" }]);
  });

  it("surfaces the problem+json detail when the server rejects before the stream opens", async () => {
    fetchMock.mockResolvedValue(
      problemResponse(400, "Bad Request", {
        type: "about:blank",
        title: "Bad Request",
        status: 400,
        code: "invalid_mode",
        detail: "'mode' must be one of: simple, advanced",
      }),
    );
    const events = await collect({ messages: MESSAGES });
    expect(events).toEqual([
      { type: "error", message: "'mode' must be one of: simple, advanced" },
    ]);
  });

  it("falls back to the status line when the failure body is not JSON", async () => {
    fetchMock.mockResolvedValue(problemResponse(502, "Bad Gateway", "<html>nope</html>"));
    const events = await collect({ messages: MESSAGES });
    expect(events).toEqual([{ type: "error", message: "HTTP 502: Bad Gateway" }]);
  });

  it("falls back to the status line when the failure body is empty", async () => {
    fetchMock.mockResolvedValue(problemResponse(429, "Too Many Requests", ""));
    const events = await collect({ messages: MESSAGES });
    expect(events).toEqual([{ type: "error", message: "HTTP 429: Too Many Requests" }]);
  });

  it("reports a network failure as an error event", async () => {
    fetchMock.mockRejectedValue(new Error("connection reset"));
    const events = await collect({ messages: MESSAGES });
    expect(events).toEqual([{ type: "error", message: "connection reset" }]);
  });

  it("abort() cancels the fetch signal without emitting an error", async () => {
    let capturedSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, opts: RequestInit) => {
      capturedSignal = opts.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
    });
    const onEvent = vi.fn();
    const handle = generateSkillStream({ messages: MESSAGES }, onEvent);
    handle.abort();
    expect(capturedSignal?.aborted).toBe(true);
    // Give the rejected fetch a tick to settle — nothing must be emitted.
    await new Promise((r) => setTimeout(r, 0));
    expect(onEvent).not.toHaveBeenCalled();
  });
});
