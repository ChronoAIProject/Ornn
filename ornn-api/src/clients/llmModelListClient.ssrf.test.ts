/**
 * Tests for #832: `LlmModelListClient` routes BOTH of its outbound
 * sites through `safeFetch`, so each is refused when its host rebinds to
 * 169.254.169.254 at fetch time:
 *
 *   1. The model-list URL fetch (`fetch({ modelListUrl, auth })`).
 *   2. The OAuth2 `tokenUrl` client_credentials exchange, taken when
 *      `auth.kind === "tokenUrl"` — an explicitly named site because it
 *      POSTs `client_secret` to an operator-supplied host. The refusal
 *      MUST fire before the secret leaves the process.
 *
 * The client catches `SsrfRefusalError` and rethrows it as-is, so the
 * caller still sees the refusal type. We assert the fetch spy recorded
 * zero calls for the refused site.
 *
 * dns is stubbed before the client imports so the shared preflight
 * (bound in `url.ts` at module load) sees the rebind — same host-aware
 * idiom as the nyxid ssrf tests.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ApiFormat,
  LlmProviderAuth,
} from "../domains/settings/llmProviders/types";

const REBIND_HOST = "rebind.test";
mock.module("node:dns/promises", () => ({
  lookup: async (host: string) =>
    host === REBIND_HOST
      ? [{ address: "169.254.169.254", family: 4 }]
      : [{ address: "93.184.216.34", family: 4 }],
}));

const { LlmModelListClient } = await import("./llmModelListClient");
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
    return new Response(JSON.stringify({ data: [], access_token: "tok" }), {
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

const apiFormat: ApiFormat = "responses";

describe("LlmModelListClient SSRF preflight (#832)", () => {
  it("refuses a rebound modelListUrl before reading the catalog", async () => {
    const auth: LlmProviderAuth = { kind: "apiKey", apiKey: "secret-key" };
    await expect(
      new LlmModelListClient().fetch({
        modelListUrl: "http://rebind.test/v1/models",
        apiFormat,
        auth,
      }),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    expect(fetchCalls).toHaveLength(0);
  });

  it("refuses a rebound OAuth2 tokenUrl before POSTing client_secret", async () => {
    // Named site: the auth.kind === "tokenUrl" client_credentials
    // exchange. tokenUrl rebinds to the metadata host — the preflight
    // must refuse before `client_secret` is posted. The model-list URL
    // is a benign public host that is never reached because auth header
    // construction fails first.
    const auth: LlmProviderAuth = {
      kind: "tokenUrl",
      tokenUrl: "http://rebind.test/oauth/token",
      clientId: "cid",
      clientSecret: "super-secret",
    };
    await expect(
      new LlmModelListClient().fetch({
        modelListUrl: "http://public-models.example.com/v1/models",
        apiFormat,
        auth,
      }),
    ).rejects.toBeInstanceOf(SsrfRefusalError);
    // Neither the token endpoint nor the model-list endpoint was hit.
    expect(fetchCalls).toHaveLength(0);
  });
});
