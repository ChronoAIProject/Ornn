import { describe, test, expect, mock, afterEach } from "bun:test";
import { AuthClient } from "./auth";

const BASE_URL = "http://auth:3801";
const SECRET = "test-secret";

describe("AuthClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("validateApiKey sends POST with key and auth header", async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify({
        data: { userId: "u-123", permissions: ["search:read"], status: "active" },
      }), { status: 200 }),
    );
    globalThis.fetch = mockFetch as any;

    const client = new AuthClient(BASE_URL, SECRET);
    const result = await client.validateApiKey("sk_testkey");

    expect(result).not.toBeNull();
    expect(result!.userId).toBe("u-123");
    expect(result!.permissions).toEqual(["search:read"]);

    const [url, opts] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/internal/api-keys/validate`);
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Internal-Auth"]).toBe(SECRET);
    const body = JSON.parse(opts.body as string);
    expect(body.key).toBe("sk_testkey");
  });

  test("returns null for invalid key (data is null)", async () => {
    const mockFetch = mock(async () =>
      new Response(JSON.stringify({ data: null }), { status: 200 }),
    );
    globalThis.fetch = mockFetch as any;

    const client = new AuthClient(BASE_URL, SECRET);
    const result = await client.validateApiKey("sk_invalid");
    expect(result).toBeNull();
  });

  test("returns null on 401 response", async () => {
    globalThis.fetch = mock(async () => new Response("unauthorized", { status: 401 })) as any;

    const client = new AuthClient(BASE_URL, SECRET);
    const result = await client.validateApiKey("sk_invalid");
    expect(result).toBeNull();
  });

  test("returns null on 404 response", async () => {
    globalThis.fetch = mock(async () => new Response("not found", { status: 404 })) as any;

    const client = new AuthClient(BASE_URL, SECRET);
    const result = await client.validateApiKey("sk_invalid");
    expect(result).toBeNull();
  });

  test("throws AppError on 500 response", async () => {
    globalThis.fetch = mock(async () => new Response("fail", { status: 500 })) as any;

    const client = new AuthClient(BASE_URL, SECRET);
    await expect(client.validateApiKey("sk_test")).rejects.toThrow("Auth service returned 500");
  });
});
