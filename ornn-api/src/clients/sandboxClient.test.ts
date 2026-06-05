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
