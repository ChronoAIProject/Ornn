/**
 * Tests for #832: the LLM gateway client (`NyxLlmClient`) routes every
 * outbound call through `safeFetch`, so a gateway host that rebinds to
 * 169.254.169.254 at fetch time is refused before the bearer token is
 * sent on the wire.
 *
 * Both surfaces — `complete()` (non-streaming) and `stream()` (SSE) —
 * are named call-sites. We inject a working SA token provider so the
 * refusal lands at the GATEWAY fetch (the site under test), not the SA
 * token exchange, and assert the `globalThis.fetch` spy recorded zero
 * calls (the refusal short-circuits before any network I/O).
 *
 * dns is stubbed before the client imports so the shared preflight
 * (bound in `url.ts` at module load) sees the rebind — same host-aware
 * idiom as `ssrf.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { NyxidSaTokenProvider } from "./base";

const REBIND_HOST = "rebind.test";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { NyxLlmClient } = await import("./llm");
const { SsrfRefusalError } = await import("../../infra/url");

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
    return new Response(JSON.stringify({ output: [] }), {
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

// Working SA token provider — the bearer is ready BEFORE the gateway
// fetch, so any refusal must come from the gateway preflight, proving
// the token never hits the wire.
const stubSa = {
  getAccessToken: async () => "sa-token",
} as unknown as NyxidSaTokenProvider;

function makeClient() {
  return new NyxLlmClient({
    resolver: async () => ({
      gatewayUrl: "http://rebind.test",
      apiKey: "",
      apiFormat: "responses" as const,
    }),
    saTokenProvider: stubSa,
  });
}

const params = {
  model: "gpt-x",
  input: [{ role: "user" as const, content: "hi" }],
};

describe("NyxLlmClient SSRF preflight (#832) — LLM gateway sites", () => {
  it("complete() refuses a rebound gatewayUrl before sending the bearer", async () => {
    await expect(makeClient().complete(params)).rejects.toBeInstanceOf(
      SsrfRefusalError,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it("stream() refuses a rebound gatewayUrl before sending the bearer", async () => {
    const iter = makeClient().stream(params);
    // `stream` is an async generator — the refusal surfaces on first
    // pull, before any SSE frame is read.
    await expect((async () => {
      for await (const _ of iter) {
        /* unreachable — refusal throws before the first event */
      }
    })()).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });
});
