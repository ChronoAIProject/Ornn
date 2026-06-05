/**
 * Behavioural tests for `LlmModelListClient` (#883 coverage).
 *
 * The SSRF-rebind path lives in the sibling `llmModelListClient.ssrf.test.ts`;
 * this file exercises the happy paths and the non-SSRF failure branches:
 *   - `buildAuthHeaders` for all four auth shapes (apiKey / basic /
 *     tokenUrl / empty) with on-the-wire assertions (Bearer header,
 *     Basic base64, OAuth2 client_credentials POST body, then the Bearer
 *     access_token), plus the token-endpoint failure modes.
 *   - payload parsing across `[]`, `{ data }`, `{ models }`, `{ items }`.
 *   - `displayName` fallback (`display_name` > `name` > `id`) and the
 *     id-trim / blank-id skip.
 *   - empty-URL guard, non-2xx with credential redaction, non-JSON body,
 *     timeout (`TimeoutError`), and generic transport error.
 *
 * Like the ssrf sibling, dns is stubbed BEFORE the client import so the
 * shared `safeFetch` preflight (bound in `url.ts` at load) sees a public
 * IP for every host and lets the in-file `fetch` spy answer. `mock.module`
 * on `node:dns/promises` is process-global and cannot be torn down per
 * file; the established exception is to make it host-aware and resolve to
 * a benign public IP, which is harmless to sibling tests.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ApiFormat,
  LlmProviderAuth,
} from "../domains/settings/llmProviders/types";

// All hosts resolve to a benign public IP so `safeFetch`'s preflight
// passes and the request reaches the in-file fetch spy.
mock.module("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const { LlmModelListClient } = await import("./llmModelListClient");

const ALLOWLIST_ENV = "ORNN_URL_ALLOWLIST_CIDR";
const originalFetch = globalThis.fetch;
const originalAllowlist = process.env[ALLOWLIST_ENV];

const apiFormat: ApiFormat = "responses";
const MODEL_LIST_URL = "https://gateway.example.com/v1/models";
const TOKEN_URL = "https://gateway.example.com/oauth/token";

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** Each queued responder answers the next fetch in call order. */
type Responder = (call: RecordedCall) => Response | Promise<Response>;

let calls: RecordedCall[];
let responders: Responder[];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  calls = [];
  responders = [];
  delete process.env[ALLOWLIST_ENV];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call: RecordedCall = { url, init };
    calls.push(call);
    const responder = responders.shift();
    if (!responder) {
      throw new Error(`No responder queued for fetch to ${url}`);
    }
    return responder(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAllowlist === undefined) delete process.env[ALLOWLIST_ENV];
  else process.env[ALLOWLIST_ENV] = originalAllowlist;
});

/** Read a header off a recorded `RequestInit` regardless of its shape. */
function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const source = init?.headers;
  if (!source) return undefined;
  const lower = name.toLowerCase();
  if (source instanceof Headers) return source.get(name) ?? undefined;
  if (Array.isArray(source)) {
    return source.find(([k]) => k.toLowerCase() === lower)?.[1];
  }
  for (const [k, v] of Object.entries(source as Record<string, string>)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

describe("LlmModelListClient.buildAuthHeaders (via fetch wire shape)", () => {
  it("apiKey → Bearer authorization header", async () => {
    responders.push(() => jsonResponse({ data: [] }));
    const auth: LlmProviderAuth = { kind: "apiKey", apiKey: "sk-test-123" };
    await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    expect(calls).toHaveLength(1);
    expect(headerOf(calls[0]?.init, "authorization")).toBe("Bearer sk-test-123");
  });

  it("apiKey with empty value → no authorization header", async () => {
    responders.push(() => jsonResponse({ data: [] }));
    const auth: LlmProviderAuth = { kind: "apiKey", apiKey: "" };
    await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    expect(headerOf(calls[0]?.init, "authorization")).toBeUndefined();
  });

  it("basic → Basic base64(user:pass) authorization header", async () => {
    responders.push(() => jsonResponse({ data: [] }));
    const auth: LlmProviderAuth = { kind: "basic", username: "alice", password: "s3cr3t" };
    await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    const expected = `Basic ${Buffer.from("alice:s3cr3t").toString("base64")}`;
    expect(headerOf(calls[0]?.init, "authorization")).toBe(expected);
  });

  it("basic with empty username → no authorization header", async () => {
    responders.push(() => jsonResponse({ data: [] }));
    const auth: LlmProviderAuth = { kind: "basic", username: "", password: "x" };
    await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    expect(headerOf(calls[0]?.init, "authorization")).toBeUndefined();
  });

  it("tokenUrl → POSTs client_credentials then uses the returned access_token", async () => {
    // First fetch: the OAuth2 token exchange. Second: the model list.
    responders.push((call) => {
      expect(call.url).toBe(TOKEN_URL);
      expect(call.init?.method).toBe("POST");
      expect(headerOf(call.init, "Content-Type")).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(String(call.init?.body));
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("client-abc");
      expect(body.get("client_secret")).toBe("client-secret-xyz");
      return jsonResponse({ access_token: "issued-token-777" });
    });
    responders.push((call) => {
      expect(call.url).toBe(MODEL_LIST_URL);
      expect(headerOf(call.init, "authorization")).toBe("Bearer issued-token-777");
      return jsonResponse({ data: [{ id: "m1" }] });
    });
    const auth: LlmProviderAuth = {
      kind: "tokenUrl",
      tokenUrl: TOKEN_URL,
      clientId: "client-abc",
      clientSecret: "client-secret-xyz",
    };
    const out = await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    expect(calls).toHaveLength(2);
    expect(out).toEqual([{ id: "m1", displayName: "m1" }]);
  });

  it("tokenUrl with empty tokenUrl → no authorization header, no token POST", async () => {
    responders.push(() => jsonResponse({ data: [] }));
    const auth: LlmProviderAuth = {
      kind: "tokenUrl",
      tokenUrl: "",
      clientId: "c",
      clientSecret: "s",
    };
    await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(MODEL_LIST_URL);
    expect(headerOf(calls[0]?.init, "authorization")).toBeUndefined();
  });
});

describe("LlmModelListClient token-endpoint failures", () => {
  const tokenAuth: LlmProviderAuth = {
    kind: "tokenUrl",
    tokenUrl: TOKEN_URL,
    clientId: "cid",
    clientSecret: "super-secret-value",
  };

  it("non-2xx token response → throws, body credential-redacted, no model fetch", async () => {
    responders.push(() =>
      new Response('{"error":"invalid_client","api_key":"leaked-key-abc"}', {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth: tokenAuth }),
    ).rejects.toThrow(/OAuth2 token exchange failed \(401\)/);
    // The model-list endpoint must never be reached when auth fails.
    expect(calls).toHaveLength(1);
  });

  it("non-2xx token body has secrets stripped before surfacing", async () => {
    responders.push(() =>
      new Response("bearer eyJsigned.jwt.value apiKey=raw-secret-123", { status: 403 }),
    );
    let message = "";
    try {
      await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth: tokenAuth });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("OAuth2 token exchange failed (403)");
    expect(message).not.toContain("eyJsigned.jwt.value");
    expect(message).not.toContain("raw-secret-123");
    expect(message).toContain("[REDACTED]");
  });

  it("token response missing access_token → throws", async () => {
    responders.push(() => jsonResponse({ token_type: "bearer" }));
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth: tokenAuth }),
    ).rejects.toThrow("OAuth2 token response missing access_token");
  });

  it("token exchange timeout → wrapped friendly timeout message", async () => {
    responders.push(() => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    });
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth: tokenAuth }),
    ).rejects.toThrow(/OAuth2 token exchange timed out after \d+ms/);
  });

  it("token exchange generic transport error → wrapped failure message", async () => {
    responders.push(() => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth: tokenAuth }),
    ).rejects.toThrow(/OAuth2 token exchange failed: ECONNREFUSED/);
  });
});

describe("LlmModelListClient payload parsing", () => {
  const auth: LlmProviderAuth = { kind: "apiKey", apiKey: "sk" };

  async function fetchWith(payload: unknown): Promise<ReadonlyArray<{ id: string; displayName: string }>> {
    responders.push(() => jsonResponse(payload));
    return new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
  }

  it("bare array payload", async () => {
    const out = await fetchWith([{ id: "a" }, { id: "b" }]);
    expect(out).toEqual([
      { id: "a", displayName: "a" },
      { id: "b", displayName: "b" },
    ]);
  });

  it("{ data } envelope", async () => {
    const out = await fetchWith({ data: [{ id: "d1" }] });
    expect(out).toEqual([{ id: "d1", displayName: "d1" }]);
  });

  it("{ models } envelope", async () => {
    const out = await fetchWith({ models: [{ id: "mm" }] });
    expect(out).toEqual([{ id: "mm", displayName: "mm" }]);
  });

  it("{ items } envelope", async () => {
    const out = await fetchWith({ items: [{ id: "it" }] });
    expect(out).toEqual([{ id: "it", displayName: "it" }]);
  });

  it("empty object envelope → empty list", async () => {
    const out = await fetchWith({});
    expect(out).toEqual([]);
  });

  it("displayName fallback: display_name > name > id", async () => {
    const out = await fetchWith({
      data: [
        { id: "x1", display_name: "Display X", name: "name-x" },
        { id: "x2", name: "name-x2" },
        { id: "x3" },
      ],
    });
    expect(out).toEqual([
      { id: "x1", displayName: "Display X" },
      { id: "x2", displayName: "name-x2" },
      { id: "x3", displayName: "x3" },
    ]);
  });

  it("trims id and skips entries with blank/missing id", async () => {
    const out = await fetchWith({
      data: [{ id: "  trimmed  " }, { id: "   " }, { name: "no-id" }, { id: "kept" }],
    });
    expect(out).toEqual([
      { id: "trimmed", displayName: "trimmed" },
      { id: "kept", displayName: "kept" },
    ]);
  });
});

describe("LlmModelListClient model-list failures", () => {
  const auth: LlmProviderAuth = { kind: "apiKey", apiKey: "sk" };

  it("empty modelListUrl → throws before any fetch", async () => {
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: "   ", apiFormat, auth }),
    ).rejects.toThrow(/model-list URL is empty/i);
    expect(calls).toHaveLength(0);
  });

  it("non-2xx → throws with status and credential-redacted body", async () => {
    responders.push(() =>
      new Response('upstream said: bearer eyLeaked.jwt.tok and apiKey=raw-leak-999', { status: 500 }),
    );
    let message = "";
    try {
      await new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("Model-list fetch failed (500)");
    expect(message).not.toContain("eyLeaked.jwt.tok");
    expect(message).not.toContain("raw-leak-999");
    expect(message).toContain("[REDACTED]");
  });

  it("non-JSON body → throws 'not valid JSON'", async () => {
    responders.push(() => new Response("<html>not json</html>", { status: 200 }));
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth }),
    ).rejects.toThrow("Model-list response was not valid JSON");
  });

  it("timeout (TimeoutError) → wrapped friendly timeout message", async () => {
    responders.push(() => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    });
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth }),
    ).rejects.toThrow(/Model-list fetch timed out after \d+ms/);
  });

  it("generic transport error → wrapped failure message", async () => {
    responders.push(() => {
      throw new Error("network down");
    });
    await expect(
      new LlmModelListClient().fetch({ modelListUrl: MODEL_LIST_URL, apiFormat, auth }),
    ).rejects.toThrow(/Model-list fetch failed: network down/);
  });
});
