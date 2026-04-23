import { describe, expect, test, vi } from "vitest";
import { OrnnClient, OrnnError } from "../index";

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OrnnClient", () => {
  test("throws if baseUrl is missing", () => {
    expect(() => new OrnnClient({ baseUrl: "" })).toThrow(/baseUrl is required/);
  });

  test("strips trailing slashes on baseUrl", async () => {
    const fetchMock = mockFetch(() => jsonResponse(200, { data: [], error: null }));
    const client = new OrnnClient({
      baseUrl: "https://ornn.example.com///",
      fetch: fetchMock,
    });
    await client.request("GET", "/ping");
    expect((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0])
      .toBe("https://ornn.example.com/api/v1/ping");
  });

  test("injects Bearer token from static option", async () => {
    let captured: Record<string, string> = {};
    const fetchMock = mockFetch((_url, init) => {
      captured = init.headers as Record<string, string>;
      return jsonResponse(200, { data: { ok: true }, error: null });
    });
    const client = new OrnnClient({
      baseUrl: "https://x",
      token: "tok_static",
      fetch: fetchMock,
    });
    await client.request("GET", "/me");
    expect(captured.Authorization).toBe("Bearer tok_static");
  });

  test("injects Bearer token from async getToken resolver", async () => {
    let captured = "";
    const fetchMock = mockFetch((_url, init) => {
      captured = (init.headers as Record<string, string>).Authorization ?? "";
      return jsonResponse(200, { data: {}, error: null });
    });
    const client = new OrnnClient({
      baseUrl: "https://x",
      getToken: async () => "tok_async_refreshed",
      fetch: fetchMock,
    });
    await client.request("GET", "/me");
    expect(captured).toBe("Bearer tok_async_refreshed");
  });

  test("getToken takes precedence over static token", async () => {
    let captured = "";
    const fetchMock = mockFetch((_url, init) => {
      captured = (init.headers as Record<string, string>).Authorization ?? "";
      return jsonResponse(200, { data: {}, error: null });
    });
    const client = new OrnnClient({
      baseUrl: "https://x",
      token: "tok_static",
      getToken: () => "tok_resolved",
      fetch: fetchMock,
    });
    await client.request("GET", "/me");
    expect(captured).toBe("Bearer tok_resolved");
  });

  test("unwraps {data, error:null} envelope on success", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(200, {
        data: { items: [{ id: "abc", name: "pdf-extract" }] },
        error: null,
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const result = await client.request<{ items: Array<{ id: string }> }>("GET", "/search");
    expect(result.items[0]!.id).toBe("abc");
  });

  test("throws OrnnError with code + status + requestId on envelope failure", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(403, {
        data: null,
        error: {
          code: "permission_denied",
          message: "Missing ornn:skill:admin",
          requestId: "req_01",
        },
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });

    await expect(client.request("GET", "/admin/stats"))
      .rejects.toMatchObject({
        name: "OrnnError",
        status: 403,
        code: "permission_denied",
        message: "Missing ornn:skill:admin",
        requestId: "req_01",
      });
  });

  test("throws OrnnError when the server returns an unenveloped non-2xx", async () => {
    const fetchMock = mockFetch(() => new Response("upstream", { status: 502 }));
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client
      .request("GET", "/anything")
      .catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(502);
    expect(err.code).toBe("unknown_error");
  });

  test("search(): maps q → query and appends params correctly", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, {
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        error: null,
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.search({
      q: "pdf",
      scope: "public",
      category: "utils",
      page: 2,
      pageSize: 50,
    });
    expect(capturedUrl).toContain("/api/v1/skill-search?");
    expect(capturedUrl).toContain("query=pdf");
    expect(capturedUrl).toContain("scope=public");
    expect(capturedUrl).toContain("category=utils");
    expect(capturedUrl).toContain("page=2");
    expect(capturedUrl).toContain("pageSize=50");
  });

  test("get(): URL-encodes the id/name path segment", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { data: { id: "x", name: "x" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.get("my/weird name");
    expect(capturedUrl).toBe("https://x/api/v1/skills/my%2Fweird%20name");
  });

  test("listVersions(): unwraps items array", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(200, {
        data: {
          items: [
            { version: "1.0", createdOn: "2026-01-01T00:00:00Z", isLatest: true },
            { version: "0.9", createdOn: "2025-12-01T00:00:00Z" },
          ],
        },
        error: null,
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const versions = await client.listVersions("abc");
    expect(versions).toHaveLength(2);
    expect(versions[0]!.version).toBe("1.0");
  });

  test("publish(): POSTs ZIP with application/zip content-type", async () => {
    let captured: { method: string; contentType: string; body: unknown } | null = null;
    const fetchMock = mockFetch((_url, init) => {
      captured = {
        method: init.method ?? "",
        contentType: (init.headers as Record<string, string>)["Content-Type"] ?? "",
        body: init.body,
      };
      return jsonResponse(200, { data: { id: "new" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    await client.publish(zipBytes);
    expect(captured!.method).toBe("POST");
    expect(captured!.contentType).toBe("application/zip");
    expect(captured!.body).toBeInstanceOf(Blob);
  });

  test("publish() with skipValidation adds ?skip_validation=true", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { data: { id: "new" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.publish(new Uint8Array([0]), { skipValidation: true });
    expect(capturedUrl).toContain("/skills?skip_validation=true");
  });

  test("downloadPackage(): returns the raw bytes, not JSON", async () => {
    const zipBytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const fetchMock = mockFetch(
      () => new Response(zipBytes, { status: 200, headers: { "Content-Type": "application/zip" } }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const buf = await client.downloadPackage("abc", "1.0");
    expect(buf.byteLength).toBe(zipBytes.byteLength);
    expect(new Uint8Array(buf)[0]).toBe(80);
  });

  test("downloadPackage(): throws OrnnError on 404", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(404, { data: null, error: { code: "resource_not_found", message: "no such version" } }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.downloadPackage("abc", "9.9").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("resource_not_found");
  });

  test("update() with metadata sends JSON body", async () => {
    let captured: { contentType: string; body: string } = { contentType: "", body: "" };
    const fetchMock = mockFetch((_url, init) => {
      captured = {
        contentType: (init.headers as Record<string, string>)["Content-Type"] ?? "",
        body: init.body as string,
      };
      return jsonResponse(200, { data: { id: "abc" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.update("abc", { metadata: { description: "new desc" } });
    expect(captured.contentType).toBe("application/json");
    expect(JSON.parse(captured.body)).toEqual({ description: "new desc" });
  });

  test("delete() fires DELETE to the skill path", async () => {
    let capturedMethod = "";
    let capturedUrl = "";
    const fetchMock = mockFetch((url, init) => {
      capturedMethod = init.method ?? "";
      capturedUrl = url;
      return jsonResponse(200, { data: { success: true }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.delete("abc");
    expect(capturedMethod).toBe("DELETE");
    expect(capturedUrl).toBe("https://x/api/v1/skills/abc");
  });
});
