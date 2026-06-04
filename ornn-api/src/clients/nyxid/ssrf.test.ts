/**
 * Tests for #811: the NyxID-family clients route every outbound request
 * through `safeFetch`, closing the DNS-rebind gap for both the
 * SA token-exchange path (`base.ts`) and the `baseApiUrl` service calls
 * (`service.ts`). A NyxID host that rebinds to 169.254.169.254 at fetch
 * time is refused before the client_secret / bearer token is sent.
 *
 * dns is stubbed before the client imports so the shared preflight
 * (bound in `url.ts` at module load) sees the rebind. Asserting the
 * `globalThis.fetch` spy recorded zero calls proves the swap is live for
 * both the token path and a `baseApiUrl` sibling.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// `mock.module` is process-global and `url.ts` binds the dns namespace
// at first load, so the stub cannot be cleanly torn down per-file. We
// therefore make it host-aware: ONLY the rebind hostname resolves to
// the cloud-metadata address; every other host (including the public
// hostnames sibling tests like llm.test.ts / service.test.ts use)
// resolves to a benign public IP, so the leaked mock is harmless.
const REBIND_HOST = "rebind.test";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { NyxidSaTokenProvider } = await import("./base");
const { NyxidServiceClient } = await import("./service");
const { NyxidOrgsClient } = await import("./orgs");
const { NyxidUserServicesClient } = await import("./userServices");
const { NyxLlmCatalogClient } = await import("./llmCatalog");
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
    return new Response(JSON.stringify({ access_token: "tok", services: [] }), {
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

describe("NyxidSaTokenProvider SSRF preflight (#811)", () => {
  function makeProvider() {
    return new NyxidSaTokenProvider(async () => ({
      tokenUrl: "http://rebind.test/oauth/token",
      clientId: "cid",
      clientSecret: "secret",
    }));
  }

  it("getAccessToken() refuses a rebound token host before posting client_secret", async () => {
    await expect(makeProvider().getAccessToken()).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("allowlisted token host passes the preflight and reaches fetch", async () => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
    const token = await makeProvider().getAccessToken();
    expect(token).toBe("tok");
    expect(fetchCalls).toEqual(["http://rebind.test/oauth/token"]);
  });
});

describe("NyxidServiceClient SSRF preflight (#811) — baseApiUrl sibling", () => {
  function makeClient() {
    return new NyxidServiceClient({
      resolver: async () => ({ baseApiUrl: "http://rebind.test" }),
    });
  }

  it("listServicesForCaller() refuses a rebound baseApiUrl before sending the bearer token", async () => {
    // listServicesForCaller fail-soft-catches errors and returns []; we
    // assert via the fetch spy that the network call never fired and the
    // refusal short-circuited the request.
    const out = await makeClient().listServicesForCaller("user-token");
    expect(out).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });

  it("listActiveServiceIdsAsPlatform() refuses a rebound baseApiUrl (SA path)", async () => {
    const ids = await makeClient().listActiveServiceIdsAsPlatform("sa-token");
    // Fail-soft returns null when the SSRF refusal is caught.
    expect(ids).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("allowlisted baseApiUrl passes the preflight and reaches fetch", async () => {
    process.env[ALLOWLIST_ENV] = "rebind.test";
    await makeClient().listServicesForCaller("user-token");
    expect(fetchCalls).toEqual(["http://rebind.test/api/v1/services"]);
  });
});

// ---------------------------------------------------------------------------
// #832 — per-call-site SSRF smoke tests. Each named outbound site must
// route through `safeFetch`, so a rebound resolver host is refused before
// the network call (and before any bearer/credential is sent). We assert
// the fetch spy recorded ZERO calls; the surfaced behaviour matches each
// client's documented contract (throw on fail-closed reads, [] on
// fail-soft reads).
// ---------------------------------------------------------------------------

describe("NyxidOrgsClient SSRF preflight (#832) — orgs sites", () => {
  // listUserOrgs is fail-closed (throws); listOrgMembers is fail-soft
  // (returns [] and logs). A working SA token provider is injected so
  // the listOrgMembers refusal lands at the /members fetch, not the SA
  // token exchange.
  const stubSa = {
    getAccessToken: async () => "sa-token",
  } as unknown as InstanceType<typeof NyxidSaTokenProvider>;

  function makeClient() {
    return new NyxidOrgsClient({
      resolver: async () => ({ baseApiUrl: "http://rebind.test" }),
      saTokenProvider: stubSa,
    });
  }

  it("listUserOrgs() refuses a rebound baseApiUrl before sending the user bearer", async () => {
    await expect(makeClient().listUserOrgs("user-token")).rejects.toBeInstanceOf(
      SsrfRefusalError,
    );
    expect(fetchCalls).toHaveLength(0);
  });

  it("listOrgMembers() refuses a rebound baseApiUrl (fail-soft []) before sending the SA bearer", async () => {
    const out = await makeClient().listOrgMembers("org-user-id");
    expect(out).toEqual([]);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("NyxidUserServicesClient SSRF preflight (#832) — user-services site", () => {
  function makeClient() {
    return new NyxidUserServicesClient({
      resolver: async () => ({ baseApiUrl: "http://rebind.test" }),
    });
  }

  it("listUserServices() refuses a rebound baseApiUrl before sending the user bearer", async () => {
    await expect(
      makeClient().listUserServices("user-token"),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });
});

describe("NyxLlmCatalogClient SSRF preflight (#832) — catalog site", () => {
  // A working SA token provider is injected so the refusal lands at the
  // catalog `/models` fetch (the named site), not the token exchange.
  const stubSa = {
    getAccessToken: async () => "sa-token",
  } as unknown as InstanceType<typeof NyxidSaTokenProvider>;

  function makeClient() {
    return new NyxLlmCatalogClient({
      resolver: async () => ({ baseApiUrl: "http://rebind.test" }),
      saTokenProvider: stubSa,
    });
  }

  it("listUpstreamModels() refuses a rebound catalog host before reading the model list", async () => {
    await expect(makeClient().listUpstreamModels()).rejects.toBeInstanceOf(
      SsrfRefusalError,
    );
    expect(fetchCalls).toHaveLength(0);
  });
});
