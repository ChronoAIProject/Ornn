/**
 * Tests for #811: StorageClient outbound calls route through `safeFetch`,
 * so a chrono-storage host that resolves to a private/metadata address
 * at fetch time is refused BEFORE the SA bearer token is sent.
 *
 * We stub `node:dns/promises` → 169.254.169.254 (cloud metadata) before
 * importing the client so the shared `assertPublicResolvedAddress`
 * (bound in `url.ts` at load) sees the rebind. The assertion that the
 * `globalThis.fetch` spy recorded zero calls is what proves the swap is
 * live — revert `fetch`→`safeFetch` and these tests fail.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// `mock.module` is process-global and `url.ts` binds the dns namespace
// at first load, so the stub cannot be cleanly torn down per-file. We
// therefore make it host-aware: ONLY the rebind hostname resolves to
// the cloud-metadata address; every other host (including the public
// hostnames sibling tests use) resolves to a benign public IP. That way
// the leaked mock is harmless to `llm.test.ts` / `service.test.ts`.
const REBIND_HOST = "rebind.test";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { StorageClient } = await import("./storageClient");
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
    return new Response(JSON.stringify({ data: { url: "x" } }), {
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
  return new StorageClient({
    resolver: async () => ({ baseUrl: "http://rebind.test", bucket: "b" }),
    getAccessToken: async () => "sa-token-xyz",
  });
}

describe("StorageClient SSRF preflight (#811)", () => {
  it("upload() refuses a rebound host before issuing the request", async () => {
    await expect(
      makeClient().upload("b", "k", new Uint8Array([1]), "text/plain"),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("delete() refuses a rebound host before issuing the request", async () => {
    await expect(makeClient().delete("b", "k")).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("getPresignedUrl() refuses a rebound host before issuing the request", async () => {
    await expect(makeClient().getPresignedUrl("b", "k")).rejects.toBeInstanceOf(
      SsrfRefusalError,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it("copy() refuses a rebound host before issuing the request", async () => {
    await expect(makeClient().copy("b", "s", "d")).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("allowlisted host passes the preflight and reaches fetch", async () => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
    const out = await makeClient().upload("b", "k", new Uint8Array([1]), "text/plain");
    expect(out).toEqual({ url: "x" });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain("http://rebind.test/api/buckets/b/objects");
  });
});
