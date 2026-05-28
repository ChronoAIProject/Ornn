/**
 * Tests for #715: deactivated NyxID services must not be exposed as
 * usable system services. `NyxidServiceClient.listServicesForCaller`
 * already drops `is_active: false` rows on a per-caller view; the new
 * `listActiveServiceIdsAsPlatform` adds the platform-wide active set
 * that anonymous-friendly aggregators (skill-facets/system-services)
 * cross-check against.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NyxidServiceClient } from "./service";

interface CapturedRequest {
  url: string;
  authorization: string;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[];
let fetchHandler: () => Promise<Response> | Response;

beforeEach(() => {
  captured = [];
  fetchHandler = () => new Response("no handler", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = init?.headers as Record<string, string> | undefined;
    captured.push({ url, authorization: headers?.Authorization ?? "" });
    return fetchHandler();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeClient(): NyxidServiceClient {
  return new NyxidServiceClient({
    resolver: async () => ({
      baseApiUrl: "https://nyxid.example.com",
      tokenBaseUrl: "https://nyxid.example.com",
      audience: "test",
      clientId: "c",
      clientSecret: "s",
    } as never),
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("NyxidServiceClient.listServicesForCaller — already drops is_active=false", () => {
  it("filters inactive services from the per-caller projection (#715 defence-in-depth)", async () => {
    fetchHandler = () =>
      jsonResponse({
        services: [
          { id: "svc-active", slug: "active", name: "Active", visibility: "public", is_active: true, created_by: "u" },
          { id: "svc-dead", slug: "dead", name: "Dead", visibility: "public", is_active: false, created_by: "u" },
        ],
      });

    const out = await makeClient().listServicesForCaller("user-token");
    expect(out.map((s) => s.id)).toEqual(["svc-active"]);
  });

  it("defaults missing is_active to active (preserves legacy NyxID responses)", async () => {
    fetchHandler = () =>
      jsonResponse({
        services: [{ id: "svc-x", slug: "x", visibility: "public", created_by: "u" }],
      });
    const out = await makeClient().listServicesForCaller("user-token");
    expect(out).toHaveLength(1);
    expect(out[0]!.isActive).toBe(true);
  });
});

describe("NyxidServiceClient.listActiveServiceIdsAsPlatform (#715)", () => {
  it("returns a Set of active service ids using the SA token", async () => {
    fetchHandler = () =>
      jsonResponse({
        services: [
          { id: "svc-1", slug: "a", visibility: "public", is_active: true, created_by: "u" },
          { id: "svc-2", slug: "b", visibility: "public", is_active: false, created_by: "u" },
          { id: "svc-3", slug: "c", visibility: "private", is_active: true, created_by: "u" },
        ],
      });

    const ids = await makeClient().listActiveServiceIdsAsPlatform("sa-token-xyz");
    expect(ids).toBeInstanceOf(Set);
    expect([...(ids ?? [])].sort()).toEqual(["svc-1", "svc-3"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://nyxid.example.com/api/v1/services");
    expect(captured[0]!.authorization).toBe("Bearer sa-token-xyz");
  });

  it("caches across calls — single upstream fetch within TTL", async () => {
    fetchHandler = () => jsonResponse({ services: [{ id: "svc-1", slug: "a", is_active: true }] });
    const client = makeClient();
    await client.listActiveServiceIdsAsPlatform("sa-token");
    await client.listActiveServiceIdsAsPlatform("sa-token");
    expect(captured).toHaveLength(1);
  });

  it("fail-soft → returns null on non-2xx (caller skips filtering)", async () => {
    fetchHandler = () => new Response("upstream is down", { status: 503 });
    const ids = await makeClient().listActiveServiceIdsAsPlatform("sa-token");
    expect(ids).toBeNull();
  });

  it("fail-soft → returns null on network throw", async () => {
    fetchHandler = () => Promise.reject(new Error("ECONNRESET"));
    const ids = await makeClient().listActiveServiceIdsAsPlatform("sa-token");
    expect(ids).toBeNull();
  });

  it("returns null when SA token is empty (won't make an unauth call)", async () => {
    const client = makeClient();
    const ids = await client.listActiveServiceIdsAsPlatform("");
    expect(ids).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("invalidateCache() drops the platform cache so the next call re-fetches", async () => {
    fetchHandler = () => jsonResponse({ services: [{ id: "svc-1", slug: "a", is_active: true }] });
    const client = makeClient();
    await client.listActiveServiceIdsAsPlatform("sa-token");
    expect(captured).toHaveLength(1);
    client.invalidateCache();
    await client.listActiveServiceIdsAsPlatform("sa-token");
    expect(captured).toHaveLength(2);
  });
});
