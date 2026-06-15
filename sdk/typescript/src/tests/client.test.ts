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

  test("strips a pathological run of trailing slashes without ReDoS (#757)", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { data: [], error: null });
    });
    // 100k trailing slashes would backtrack polynomially under a
    // `/\/+$/` regex; the linear strip handles it in O(n). The test
    // returning promptly (no timeout) is the assertion that matters.
    const client = new OrnnClient({
      baseUrl: "https://x" + "/".repeat(100_000),
      fetch: fetchMock,
    });
    await client.request("GET", "/ping");
    expect(capturedUrl).toBe("https://x/api/v1/ping");
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

  test("throws OrnnError parsing RFC 7807 problem+json body (#456)", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(403, {
        type: "https://github.com/.../ERRORS.md#permission_denied",
        title: "Permission denied",
        status: 403,
        code: "permission_denied",
        detail: "Missing ornn:skill:admin",
        instance: "/v1/admin/stats",
        requestId: "req_01",
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

  test("search(): sends q= and appends params correctly", async () => {
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
    // Canonical search param per CONVENTIONS.md §4.1 (#586).
    expect(capturedUrl).toContain("q=pdf");
    expect(capturedUrl).not.toContain("query=pdf");
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

  test("downloadPackage(): resolves the presigned URL via detail, fetches the bytes (#1011)", async () => {
    const zipBytes = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const presignedUrl = "https://obj.example.com/bucket/abc-1.0.zip?sig=xyz";
    let detailUrl = "";
    let fetchedPresigned = "";
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/v1/skills/")) {
        detailUrl = url;
        // Skill-detail read — carries the presigned URL, no skillHash.
        return jsonResponse(200, {
          data: { id: "abc", name: "abc", presignedPackageUrl: presignedUrl },
          error: null,
        });
      }
      // The absolute object-storage URL — returns the raw package bytes.
      fetchedPresigned = url;
      return new Response(zipBytes, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const buf = await client.downloadPackage("abc", "1.0");
    // Detail read threads ?version= ; the presigned fetch is the bare URL.
    expect(detailUrl).toBe("https://x/api/v1/skills/abc?version=1.0");
    expect(fetchedPresigned).toBe(presignedUrl);
    expect(buf.byteLength).toBe(zipBytes.byteLength);
    expect(new Uint8Array(buf)[0]).toBe(80);
  });

  test("downloadPackage(): version is optional — omits ?version= (#1011)", async () => {
    let detailUrl = "";
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/v1/skills/")) {
        detailUrl = url;
        return jsonResponse(200, {
          data: { id: "abc", name: "abc", presignedPackageUrl: "https://obj.example.com/z.zip" },
          error: null,
        });
      }
      return new Response(new Uint8Array([80, 75]), { status: 200 });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.downloadPackage("abc");
    expect(detailUrl).toBe("https://x/api/v1/skills/abc");
  });

  test("downloadPackage(): throws package_not_found when detail has no presigned URL (#1011)", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(200, { data: { id: "abc", name: "abc" }, error: null }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.downloadPackage("abc", "1.0").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("package_not_found");
  });

  test("downloadPackage(): throws OrnnError when the underlying skill read 404s (#1011)", async () => {
    // The detail read is the first hop; its 404 (RFC 7807) propagates.
    const fetchMock = mockFetch(() =>
      jsonResponse(404, {
        type: "https://github.com/.../ERRORS.md#resource_not_found",
        title: "Resource not found",
        status: 404,
        code: "resource_not_found",
        detail: "no such skill",
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.downloadPackage("abc", "9.9").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("resource_not_found");
  });

  test("downloadPackage(): throws package_download_failed on a non-2xx presigned fetch (#1011)", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/v1/skills/")) {
        return jsonResponse(200, {
          data: { id: "abc", name: "abc", presignedPackageUrl: "https://obj.example.com/z.zip" },
          error: null,
        });
      }
      // Object storage rejects the (now-expired) presigned URL.
      return new Response("expired", { status: 403 });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.downloadPackage("abc", "1.0").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("package_download_failed");
  });

  test("downloadPackage(): verifies skillHash and returns the bytes on match (#1011)", async () => {
    const zipBytes = new Uint8Array([80, 75, 3, 4]);
    // Pre-computed SHA-256 of the four bytes below, asserted at runtime
    // against the SDK's own WebCrypto digest so the test is self-checking.
    const digest = await crypto.subtle.digest("SHA-256", zipBytes);
    const expectedHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/v1/skills/")) {
        return jsonResponse(200, {
          data: {
            id: "abc",
            name: "abc",
            presignedPackageUrl: "https://obj.example.com/z.zip",
            skillHash: expectedHash,
          },
          error: null,
        });
      }
      return new Response(zipBytes, { status: 200 });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const buf = await client.downloadPackage("abc", "1.0");
    expect(new Uint8Array(buf)).toEqual(zipBytes);
  });

  test("downloadPackage(): throws integrity_mismatch when skillHash disagrees (#1011)", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/v1/skills/")) {
        return jsonResponse(200, {
          data: {
            id: "abc",
            name: "abc",
            presignedPackageUrl: "https://obj.example.com/z.zip",
            skillHash: "deadbeef", // deliberately wrong
          },
          error: null,
        });
      }
      return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.downloadPackage("abc", "1.0").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.code).toBe("integrity_mismatch");
  });

  test("resolveClosure(): parses the topo-ordered items envelope (#968)", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, {
        data: {
          items: [
            { guid: "g-c", name: "c", version: "1.0", skillHash: "h-c", depth: 1 },
            { guid: "g-b", name: "b", version: "1.0", skillHash: "h-b", depth: 0 },
          ],
        },
        error: null,
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const result = await client.resolveClosure("report-gen", { version: "1.0" });
    expect(capturedUrl).toBe("https://x/api/v1/skills/report-gen/closure?version=1.0");
    expect(result.items.map((i) => i.name)).toEqual(["c", "b"]);
    expect(result.items[0]!.depth).toBe(1);
  });

  test("resolveClosure(): omits the version query when not provided", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { data: { items: [] }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.resolveClosure("report-gen");
    expect(capturedUrl).toBe("https://x/api/v1/skills/report-gen/closure");
  });

  test("resolveClosure(): throws OrnnError on dependency_cycle (409)", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(409, {
        type: "https://github.com/.../ERRORS.md#resource_conflict",
        title: "Conflict",
        status: 409,
        code: "dependency_cycle",
        detail: "cycle at a@1.0",
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.resolveClosure("a").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("dependency_cycle");
  });

  test("pullClosure(): downloads each package in topological order (#968)", async () => {
    const downloadOrder: string[] = [];
    const fetchMock = mockFetch((url) => {
      if (url.includes("/closure")) {
        return jsonResponse(200, {
          data: {
            items: [
              { guid: "g-c", name: "c", version: "1.0", skillHash: "h-c", depth: 1 },
              { guid: "g-b", name: "b", version: "1.0", skillHash: "h-b", depth: 0 },
            ],
          },
          error: null,
        });
      }
      // Per-node skill-detail read (#1011) — record order, hand back a
      // presigned URL pointing at that node's object-storage artifact.
      const detailMatch = url.match(/\/api\/v1\/skills\/([^/?]+)/);
      if (detailMatch) {
        const guid = detailMatch[1]!;
        downloadOrder.push(guid);
        return jsonResponse(200, {
          data: {
            id: guid,
            name: guid,
            presignedPackageUrl: `https://obj.example.com/${guid}.zip`,
          },
          error: null,
        });
      }
      // The absolute presigned-URL fetch — raw bytes.
      return new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const { closure, packages } = await client.pullClosure("report-gen");
    expect(closure.items).toHaveLength(2);
    // Downloads follow the closure order — c (deps-first) before b.
    expect(downloadOrder).toEqual(["g-c", "g-b"]);
    expect(packages).toHaveLength(2);
    expect(packages[0]!.node.name).toBe("c");
    expect(packages[0]!.bytes.byteLength).toBe(4);
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

// ======================================================================
// Skillsets (#969)
// ======================================================================

describe("OrnnClient — skillsets", () => {
  test("createSkillset(): POSTs JSON to /skillsets", async () => {
    let captured: { method: string; url: string; body: string; ct: string } = {
      method: "",
      url: "",
      body: "",
      ct: "",
    };
    const fetchMock = mockFetch((url, init) => {
      captured = {
        method: init.method ?? "",
        url,
        body: init.body as string,
        ct: (init.headers as Record<string, string>)["Content-Type"] ?? "",
      };
      return jsonResponse(201, {
        data: { guid: "ss-1", name: "review-set", kind: "generic", members: ["a@1.0", "b@1.0"] },
        error: null,
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const result = await client.createSkillset({
      name: "review-set",
      description: "d",
      instructions: "Run a, then feed its output to b.",
      members: ["a@1.0", "b@1.0"],
    });
    expect(captured.method).toBe("POST");
    expect(captured.url).toBe("https://x/api/v1/skillsets");
    expect(captured.ct).toBe("application/json");
    // The master prompt (#978) is sent on the wire.
    expect(JSON.parse(captured.body)).toEqual({
      name: "review-set",
      description: "d",
      instructions: "Run a, then feed its output to b.",
      members: ["a@1.0", "b@1.0"],
    });
    expect(result.guid).toBe("ss-1");
  });

  test("getSkillset(): URL-encodes the id and appends version", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, { data: { guid: "ss-1", name: "review-set" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.getSkillset("review set", "1.1");
    expect(capturedUrl).toBe("https://x/api/v1/skillsets/review%20set?version=1.1");
  });

  test("publishSkillset(): PUTs JSON to /skillsets/:id with instructions", async () => {
    let captured = { method: "", url: "", body: "" };
    const fetchMock = mockFetch((url, init) => {
      captured = { method: init.method ?? "", url, body: init.body as string };
      return jsonResponse(200, { data: { guid: "ss-1", version: "1.1" }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const res = await client.publishSkillset("ss-1", {
      instructions: "v1.1 prompt: b first this time",
      members: ["a@1.0", "b@1.0"],
      version: "1.1",
    });
    expect(captured.method).toBe("PUT");
    expect(captured.url).toBe("https://x/api/v1/skillsets/ss-1");
    // The master prompt (#978) is sent on publish too (no carry-forward).
    expect(JSON.parse(captured.body).instructions).toBe("v1.1 prompt: b first this time");
    expect(res.version).toBe("1.1");
  });

  test("setSkillsetPermissions(): unwraps the { skillset } envelope", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(200, {
        data: { skillset: { guid: "ss-1", isPrivate: false } },
        error: null,
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const res = await client.setSkillsetPermissions("ss-1", { isPrivate: false });
    expect(res.guid).toBe("ss-1");
    expect(res.isPrivate).toBe(false);
  });

  test("deleteSkillset(): fires DELETE to /skillsets/:id", async () => {
    let captured = { method: "", url: "" };
    const fetchMock = mockFetch((url, init) => {
      captured = { method: init.method ?? "", url };
      return jsonResponse(200, { data: { success: true }, error: null });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.deleteSkillset("ss-1");
    expect(captured.method).toBe("DELETE");
    expect(captured.url).toBe("https://x/api/v1/skillsets/ss-1");
  });

  test("getSkillsetClosure(): hits /skillsets/:id/closure and parses items + instructions", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, {
        data: {
          instructions: "master prompt: leaf-d feeds pdf-tools",
          items: [
            { guid: "g-d", name: "leaf-d", version: "1.0", depth: 1 },
            { guid: "g-a", name: "pdf-tools", version: "1.0", depth: 0 },
          ],
        },
        error: null,
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const result = await client.getSkillsetClosure("review-set", { version: "1.0" });
    expect(capturedUrl).toBe("https://x/api/v1/skillsets/review-set/closure?version=1.0");
    expect(result.items.map((i) => i.name)).toEqual(["leaf-d", "pdf-tools"]);
    // The master prompt (#978) parses as a root sibling of items.
    expect(result.instructions).toBe("master prompt: leaf-d feeds pdf-tools");
  });

  test("getSkillsetClosure(): throws OrnnError on dependency_conflict (409)", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(409, {
        status: 409,
        code: "dependency_conflict",
        detail: "two versions of x",
      }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.getSkillsetClosure("ss-1").catch((e) => e)) as OrnnError;
    expect(err).toBeInstanceOf(OrnnError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("dependency_conflict");
  });

  test("getSkillset(): throws OrnnError on 404", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(404, { status: 404, code: "skillset_not_found", detail: "nope" }),
    );
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    const err = (await client.getSkillset("ghost").catch((e) => e)) as OrnnError;
    expect(err.status).toBe(404);
    expect(err.code).toBe("skillset_not_found");
  });

  test("searchSkillsets(): forwards kind + tags + scope as query params", async () => {
    let capturedUrl = "";
    const fetchMock = mockFetch((url) => {
      capturedUrl = url;
      return jsonResponse(200, {
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        error: null,
      });
    });
    const client = new OrnnClient({ baseUrl: "https://x", fetch: fetchMock });
    await client.searchSkillsets({ kind: "consensus-supported", tag: "alpha", scope: "public" });
    expect(capturedUrl).toContain("kind=consensus-supported");
    expect(capturedUrl).toContain("tags=alpha");
    expect(capturedUrl).toContain("scope=public");
  });
});
