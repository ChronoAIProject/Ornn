/**
 * Tests for #811: SandboxClient outbound calls route through `safeFetch`.
 * A chrono-sandbox host that rebinds to a private/metadata address at
 * fetch time is refused before the SA bearer token leaves the process.
 *
 * dns is stubbed → 169.254.169.254 before the client import so the
 * shared preflight (bound in `url.ts` at load) catches the rebind. The
 * zero-fetch-call assertion proves the swap is live.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// `mock.module` is process-global and `url.ts` binds the dns namespace
// at first load, so the stub cannot be cleanly torn down per-file. We
// therefore make it host-aware: ONLY the rebind hostname resolves to
// the cloud-metadata address; every other host resolves to a benign
// public IP, so the leaked mock is harmless to sibling tests.
const REBIND_HOST = "rebind.test";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { SandboxClient } = await import("./sandboxClient");
const { SsrfRefusalError } = await import("../infra/url");

const ALLOWLIST_ENV = "ORNN_URL_ALLOWLIST_CIDR";
const originalFetch = globalThis.fetch;
const originalAllowlist = process.env[ALLOWLIST_ENV];

let fetchCalls: string[];

beforeEach(() => {
  fetchCalls = [];
  delete process.env[ALLOWLIST_ENV];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push(url);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowlist === undefined) delete process.env[ALLOWLIST_ENV];
  else process.env[ALLOWLIST_ENV] = originalAllowlist;
});

function makeClient() {
  return new SandboxClient({
    resolver: async () => ({ baseUrl: "http://rebind.test" }),
    getAccessToken: async () => "sa-token-xyz",
  });
}

/** Drain an async generator to force the underlying request to fire. */
async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* discard */
  }
}

describe("SandboxClient SSRF preflight (#811)", () => {
  it("execute() (POST path) refuses a rebound host before issuing the request", async () => {
    await expect(
      makeClient().execute({ script: "print(1)", language: "python" }),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("deleteSession() refuses a rebound host before issuing the request", async () => {
    await expect(makeClient().deleteSession("s1")).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("listSessions() refuses a rebound host before issuing the request", async () => {
    await expect(makeClient().listSessions()).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("executeStream() (SSE path) refuses a rebound host before issuing the request", async () => {
    await expect(
      drain(makeClient().executeStream({ script: "print(1)", language: "python" })),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("allowlisted host passes the preflight and reaches fetch", async () => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
    const res = await makeClient().execute({ script: "print(1)", language: "python" });
    expect(res.success).toBe(true);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toBe("http://rebind.test/execute");
  });
});

// ── #883: behavioural coverage for the request/response paths ──────────
//
// These reuse the same host-aware dns stub above. Each test allowlists
// `rebind.test` so the SSRF preflight passes and the request reaches a
// per-test fetch responder, letting us assert request bodies, response
// mapping, error wrapping, and the SSE parser. The fetch spy is replaced
// per test via `setResponder` (restored by the outer `afterEach`).

interface SbCall {
  url: string;
  init: RequestInit | undefined;
}

let sbCalls: SbCall[];
type SbResponder = (call: SbCall) => Response;

function setResponder(responder: SbResponder): void {
  sbCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const call: SbCall = { url, init };
    sbCalls.push(call);
    return responder(call);
  }) as typeof fetch;
}

function bodyOf(call: SbCall | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Build a `text/event-stream` response from raw line chunks. Each entry
 * is written verbatim (callers include their own `data: ` prefix and
 * newlines) so we can exercise the parser's skip-on-non-`data:` and
 * skip-on-unparseable branches.
 */
function sseResponse(chunks: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("SandboxClient.execute (#883)", () => {
  beforeEach(() => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
  });

  it("maps params to snake_case body with defaults and returns the result", async () => {
    setResponder(() => jsonResponse({ success: true, output: { exit_code: 0, execution_time_ms: 12 } }));
    const res = await makeClient().execute({ script: "print(1)", language: "python" });
    expect(res.success).toBe(true);
    expect(sbCalls).toHaveLength(1);
    expect(sbCalls[0]?.url).toBe("http://rebind.test/execute");
    const body = bodyOf(sbCalls[0]);
    expect(body.script).toBe("print(1)");
    expect(body.output_type).toBe("text");
    expect(body.timeout_secs).toBe(60);
    expect(body.network_enabled).toBe(true);
    expect(body.env).toEqual({});
    expect(body.dependencies).toEqual([]);
    expect(body.retrieve_files).toEqual([]);
    expect(body.input_files).toEqual([]);
    expect(body.resources).toBeUndefined();
    expect(body.image).toBeUndefined();
  });

  it("forwards explicit overrides incl. resources and image", async () => {
    setResponder(() => jsonResponse({ success: true }));
    await makeClient().execute({
      script: "x",
      language: "python",
      outputType: "file",
      timeoutSecs: 120,
      networkEnabled: false,
      resources: { cpu: "2", memory: "1Gi" },
      image: "custom:tag",
    });
    const body = bodyOf(sbCalls[0]);
    expect(body.output_type).toBe("file");
    expect(body.timeout_secs).toBe(120);
    expect(body.network_enabled).toBe(false);
    expect(body.resources).toEqual({ cpu: "2", memory: "1Gi" });
    expect(body.image).toBe("custom:tag");
  });

  it("returns a failure result without throwing (warn branch)", async () => {
    setResponder(() =>
      jsonResponse({ success: false, error: { code: "RUNTIME", message: "boom" } }),
    );
    const res = await makeClient().execute({ script: "1/0", language: "python" });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("RUNTIME");
  });

  it("non-2xx → throws a 'Sandbox service error'", async () => {
    setResponder(() => new Response("upstream exploded", { status: 502 }));
    await expect(
      makeClient().execute({ script: "x", language: "python" }),
    ).rejects.toThrow(/Sandbox service error \(502\)/);
  });
});

describe("SandboxClient sessions (#883)", () => {
  beforeEach(() => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
  });

  it("createSession maps body + defaults and returns the session", async () => {
    setResponder(() =>
      jsonResponse({ session_id: "sess-1", status: "ready", expires_at: 999 }),
    );
    const res = await makeClient().createSession({
      language: "python",
      ttlSecs: 300,
      resources: { cpu: "1" },
      image: "img:1",
    });
    expect(res.session_id).toBe("sess-1");
    expect(sbCalls[0]?.url).toBe("http://rebind.test/sessions");
    const body = bodyOf(sbCalls[0]);
    expect(body.language).toBe("python");
    expect(body.network_enabled).toBe(true);
    expect(body.dependencies).toEqual([]);
    expect(body.ttl_secs).toBe(300);
    expect(body.resources).toEqual({ cpu: "1" });
    expect(body.image).toBe("img:1");
  });

  it("createSession non-2xx → throws", async () => {
    setResponder(() => new Response("nope", { status: 500 }));
    await expect(makeClient().createSession({ language: "python" })).rejects.toThrow(
      /Sandbox service error \(500\)/,
    );
  });

  it("sessionExecute success maps body + returns result", async () => {
    setResponder(() => jsonResponse({ success: true, output: { exit_code: 0 } }));
    const res = await makeClient().sessionExecute("sess-2", { script: "y", language: "python" });
    expect(res.success).toBe(true);
    expect(sbCalls[0]?.url).toBe("http://rebind.test/sessions/sess-2/execute");
    const body = bodyOf(sbCalls[0]);
    expect(body.timeout_secs).toBe(60);
    expect(body.output_type).toBe("text");
  });

  it("sessionExecute failure → returns result (warn branch)", async () => {
    setResponder(() => jsonResponse({ success: false, error: { code: "E", message: "m" } }));
    const res = await makeClient().sessionExecute("sess-3", { script: "z", language: "python" });
    expect(res.success).toBe(false);
  });

  it("deleteSession ok resolves; non-2xx throws", async () => {
    setResponder(() => new Response(null, { status: 204 }));
    await expect(makeClient().deleteSession("sess-4")).resolves.toBeUndefined();
    expect(sbCalls[0]?.init?.method).toBe("DELETE");

    setResponder(() => new Response("missing", { status: 404 }));
    await expect(makeClient().deleteSession("sess-5")).rejects.toThrow(
      /Delete session failed \(404\)/,
    );
  });

  it("listSessions ok returns payload; non-2xx throws", async () => {
    setResponder(() => jsonResponse({ sessions: [{ session_id: "s" }] }));
    const res = await makeClient().listSessions();
    expect(res.sessions).toHaveLength(1);

    setResponder(() => new Response("down", { status: 503 }));
    await expect(makeClient().listSessions()).rejects.toThrow(/List sessions failed \(503\)/);
  });
});

describe("SandboxClient streaming SSE (#883)", () => {
  beforeEach(() => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
  });

  it("executeStream parses data: lines into the event sequence", async () => {
    setResponder(() =>
      sseResponse([
        'data: {"type":"stdout","text":"hello"}\n',
        'data: {"type":"complete","exit_code":0,"execution_time_ms":5}\n',
      ]),
    );
    const events = await collect(makeClient().executeStream({ script: "p", language: "python" }));
    expect(events).toEqual([
      { type: "stdout", text: "hello" },
      { type: "complete", exit_code: 0, execution_time_ms: 5 },
    ]);
    expect(sbCalls[0]?.url).toBe("http://rebind.test/execute/stream");
  });

  it("skips blank, non-data, and unparseable lines", async () => {
    setResponder(() =>
      sseResponse([
        ": comment line\n",
        "event: ping\n",
        "data: \n",
        "data: not-json{\n",
        'data: {"type":"stderr","text":"warn"}\n',
      ]),
    );
    const events = await collect(makeClient().executeStream({ script: "p", language: "python" }));
    expect(events).toEqual([{ type: "stderr", text: "warn" }]);
  });

  it("sessionExecuteStream routes to the session stream path", async () => {
    setResponder(() => sseResponse(['data: {"type":"stdout","text":"x"}\n']));
    const events = await collect(
      makeClient().sessionExecuteStream("sess-9", { script: "p", language: "python" }),
    );
    expect(events).toEqual([{ type: "stdout", text: "x" }]);
    expect(sbCalls[0]?.url).toBe("http://rebind.test/sessions/sess-9/execute/stream");
  });

  it("non-ok stream response → throws before reading the body", async () => {
    setResponder(() => new Response("bad", { status: 500 }));
    await expect(
      collect(makeClient().executeStream({ script: "p", language: "python" })),
    ).rejects.toThrow(/Sandbox stream error \(500\)/);
  });

  it("missing response body → throws", async () => {
    setResponder(() => new Response(null, { status: 200 }));
    await expect(
      collect(makeClient().executeStream({ script: "p", language: "python" })),
    ).rejects.toThrow("No response body for SSE stream");
  });
});
