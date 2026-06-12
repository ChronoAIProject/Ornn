/**
 * Tests for #811 (SSRF-preflight) + #832 (redirect-hop hardening) for
 * the shared `safeFetch` primitive.
 *
 * `safeFetch` re-resolves the outbound host at fetch time via
 * `assertPublicResolvedAddress` (which calls `dns.lookup`) and refuses
 * private/loopback/link-local resolutions BEFORE the real `fetch` —
 * the DNS-rebind defense. We stub `node:dns/promises` so a public
 * hostname resolves to the cloud-metadata address `169.254.169.254`
 * and assert the wrapper rejects without ever issuing the network call.
 *
 * #832 forces `redirect: "manual"` and follows 3xx ourselves in a
 * bounded loop, re-validating EACH hop's host. The redirect tests use a
 * scripted per-URL fetch queue (keyed by URL, not call order) so a host
 * can return a 302 once and a 200 next, without order-fragility.
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
// the rebind hostnames resolve to the cloud-metadata address; every
// other host resolves to a benign public IP, so the leaked stub is
// harmless to sibling tests that hit real public hostnames.
const REBIND_HOST = "evil.example.com";
const METADATA_HOST = "169.254.169.254";
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

/**
 * Scripted per-URL response queue. Map a URL to an array of Responses;
 * each call to that URL shifts the next one (the last one sticks once
 * the queue is drained). Keyed by URL — no order-fragility across hosts.
 */
let scriptedResponses: Map<string, Response[]>;

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

/** A 302 redirect Response pointing at `location`. */
function redirect302(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

beforeEach(() => {
  fetchCalls = [];
  scriptedResponses = new Map();
  delete process.env[ALLOWLIST_ENV];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = urlOf(input);
    fetchCalls.push(url);
    const queue = scriptedResponses.get(url);
    if (queue && queue.length > 0) {
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    }
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

  it("forwards init structurally and sets redirect:manual (#832)", async () => {
    // #832 spreads init to inject `redirect: "manual"`, so the forwarded
    // object is no longer reference-identical. Assert the load-bearing
    // fields survive the spread AND that manual-redirect is forced on.
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const init: RequestInit = { method: "POST", headers: { "X-Test": "1" }, body: "payload" };
    await safeFetch("http://93.184.216.34/x", init);
    expect(capturedInit).toMatchObject({
      method: "POST",
      headers: { "X-Test": "1" },
      body: "payload",
    });
    expect(capturedInit?.redirect).toBe("manual");
  });

  it("throws on an invalid URL before resolving or fetching", async () => {
    await expect(safeFetch("not a url")).rejects.toThrow(/Invalid URL/);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("safeFetch — bounded manual redirect follow (#832)", () => {
  it("refuses a first-hop 302 → metadata host; second fetch never fires", async () => {
    // hop1 (public host) returns a 302 pointing at the cloud-metadata
    // address. The loop re-validates the redirect target before its
    // fetch — `evil.example.com` resolves to 169.254.169.254 so the
    // SECOND fetch never fires.
    const hop1 = "http://public-a.example.com/start";
    scriptedResponses.set(hop1, [redirect302("http://evil.example.com/")]);

    await expect(safeFetch(hop1)).rejects.toBeInstanceOf(SsrfRefusalError);
    // Only the first hop's fetch fired; the metadata target was refused
    // by the preflight before its network call.
    expect(fetchCalls).toEqual([hop1]);
  });

  it("refuses a 302 to a literal metadata IP; second fetch never fires", async () => {
    // A redirect straight to the literal 169.254.169.254 is caught by
    // the per-hop URL guard (private IP literal) before its fetch.
    const hop1 = "http://public-a.example.com/start";
    scriptedResponses.set(hop1, [redirect302(`http://${METADATA_HOST}/latest/meta-data/`)]);

    await expect(safeFetch(hop1)).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toEqual([hop1]);
  });

  it("follows a same-host PUBLIC 302 and returns the final 200", async () => {
    // Criterion 2: a legitimate public redirect still succeeds. Same
    // host, so credentials (if any) are preserved.
    const hop1 = "http://public-a.example.com/start";
    const hop2 = "http://public-a.example.com/final";
    scriptedResponses.set(hop1, [redirect302(hop2)]);
    scriptedResponses.set(hop2, [new Response("done", { status: 200 })]);

    const res = await safeFetch(hop1);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("done");
    expect(fetchCalls).toEqual([hop1, hop2]);
  });

  it("strips Authorization on a cross-host PUBLIC redirect", async () => {
    // hop1 (hostA) carries an Authorization header and 302s to hostB —
    // both public. The follow must NOT carry the bearer token to hostB.
    const hop1 = "http://public-a.example.com/start";
    const hop2 = "http://public-b.example.com/final";
    scriptedResponses.set(hop1, [redirect302(hop2)]);
    scriptedResponses.set(hop2, [new Response("done", { status: 200 })]);

    let hop2Init: RequestInit | undefined;
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input) === hop2) hop2Init = init;
      return baseFetch(input, init);
    }) as typeof fetch;

    const res = await safeFetch(hop1, {
      headers: { Authorization: "Bearer secret-token", "X-Keep": "1" },
    });
    expect(res.status).toBe(200);
    expect(fetchCalls).toEqual([hop1, hop2]);

    // The Authorization header must be gone on the cross-host hop;
    // non-sensitive headers are preserved.
    const hop2Headers = new Headers(hop2Init?.headers as HeadersInit);
    expect(hop2Headers.has("authorization")).toBe(false);
    expect(hop2Headers.get("x-keep")).toBe("1");
  });

  it("throws after MAX_REDIRECTS on a self-redirect loop", async () => {
    // Self-redirect loop on a public host — every hop returns a 302 to
    // itself. The loop caps at MAX_REDIRECTS (5) + the initial attempt,
    // so at most 6 fetch calls before the limit error.
    const loopUrl = "http://public-loop.example.com/spin";
    scriptedResponses.set(loopUrl, [redirect302(loopUrl)]);

    await expect(safeFetch(loopUrl)).rejects.toThrow(/Too many redirects/);
    expect(fetchCalls.length).toBeLessThanOrEqual(6);
    expect(fetchCalls.every((u) => u === loopUrl)).toBe(true);
  });
});
