/**
 * Tests for #811: the shared SSRF-preflight `safeFetch` primitive.
 *
 * `safeFetch` re-resolves the outbound host at fetch time via
 * `assertPublicResolvedAddress` (which calls `dns.lookup`) and refuses
 * private/loopback/link-local resolutions BEFORE the real `fetch` —
 * the DNS-rebind defense. We stub `node:dns/promises` so a public
 * hostname resolves to the cloud-metadata address `169.254.169.254`
 * and assert the wrapper rejects without ever issuing the network call.
 *
 * `url.ts` binds `dns` at module load (`import * as dns from
 * "node:dns/promises"`), so the `mock.module` MUST be installed before
 * the modules under test are imported — hence the top-level mock +
 * dynamic `import()` (same idiom as mirror/scheduler.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Install the dns mock BEFORE importing the module under test so
// `url.ts` binds the stub at load time. `mock.module` is process-global
// and `url.ts` binds the dns namespace once, so the stub cannot be
// cleanly torn down per-file — we therefore make it host-aware: ONLY
// the rebind hostname resolves to the cloud-metadata address; every
// other host resolves to a benign public IP, so the leaked stub is
// harmless to sibling tests that hit real public hostnames.
const REBIND_HOST = "evil.example.com";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { safeFetch } = await import("./safeFetch");
const { SsrfRefusalError } = await import("./url");

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
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowlist === undefined) delete process.env[ALLOWLIST_ENV];
  else process.env[ALLOWLIST_ENV] = originalAllowlist;
});

describe("safeFetch — DNS-rebind preflight (#811)", () => {
  it("rejects with SsrfRefusalError and never calls fetch when the host resolves to a private address", async () => {
    await expect(safeFetch("http://evil.example.com/x")).rejects.toBeInstanceOf(
      SsrfRefusalError,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it("lets the request through (fetch IS called) when the host is operator-allowlisted — DNS resolution skipped", async () => {
    process.env[ALLOWLIST_ENV] = "evil.example.com";
    const res = await safeFetch("http://evil.example.com/x");
    expect(res.status).toBe(200);
    expect(fetchCalls).toEqual(["http://evil.example.com/x"]);
  });

  it("lets the request through for a literal public IP (upstream already vetted the literal — no re-resolution)", async () => {
    const res = await safeFetch("http://93.184.216.34/x");
    expect(res.status).toBe(200);
    expect(fetchCalls).toEqual(["http://93.184.216.34/x"]);
  });

  it("forwards the init object verbatim to fetch", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const init: RequestInit = { method: "POST", headers: { "X-Test": "1" }, body: "payload" };
    await safeFetch("http://93.184.216.34/x", init);
    expect(capturedInit).toBe(init);
  });

  it("throws on an invalid URL before resolving or fetching", async () => {
    await expect(safeFetch("not a url")).rejects.toThrow(/Invalid URL/);
    expect(fetchCalls).toHaveLength(0);
  });
});
