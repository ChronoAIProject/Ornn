import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { StorageClient } from "../storageClient";
import { NyxidSaTokenProvider } from "./base";
import { deferred, tokenHarness } from "./saTestHarness";

let h: ReturnType<typeof tokenHarness>;
let allowlist: string | undefined;
beforeEach(() => {
  allowlist = process.env.ORNN_URL_ALLOWLIST_CIDR;
  process.env.ORNN_URL_ALLOWLIST_CIDR = "127.0.0.1";
  h = tokenHarness();
});
afterEach(() => {
  h.close();
  if (allowlist === undefined) delete process.env.ORNN_URL_ALLOWLIST_CIDR;
  else process.env.ORNN_URL_ALLOWLIST_CIDR = allowlist;
});
function storage() {
  return new StorageClient({ resolver: async () => ({ baseUrl: h.base, bucket: "skills" }), saTokenProvider: h.provider });
}
const bytes = new Uint8Array([0, 255, 128, 10, 13, 42]);
const upload = () => storage().upload("skills", "a b/c.zip", bytes, "application/zip");

describe("revoked shared service-account tokens (#1265)", () => {
  it("replays an upload once with identical bytes, content type, path and query", async () => {
    const old = await h.provider.getAccessToken();
    const requests: { url: string; type: string | null; bytes: number[] }[] = [];
    h.setDownstream(async (req) => {
      requests.push({ url: req.url, type: req.headers.get("content-type"), bytes: [...new Uint8Array(await req.arrayBuffer())] });
      return req.headers.get("authorization") === `Bearer ${old}`
        ? new Response(old, { status: 401 }) : Response.json({ data: { url: "uploaded" } });
    });
    expect(await upload()).toEqual({ url: "uploaded" });
    expect(h.mintCount).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[1]?.bytes).toEqual([...bytes]);
    expect(requests[1]?.type).toBe("application/zip");
    expect(new URL(requests[1]!.url).searchParams.get("key")).toBe("a b/c.zip");
  });

  it.each(["delete", "downloadObject"] as const)("refreshes storage %s", async (method) => {
    const old = await h.provider.getAccessToken();
    h.setDownstream((req) => req.headers.get("authorization") === `Bearer ${old}`
      ? new Response(null, { status: 401 }) : new Response(bytes));
    await storage()[method]("skills", "key");
    expect(h.mintCount).toBe(2);
  });

  it.each([403, 500, 502, 429])("does not replay status %s", async (status) => {
    let calls = 0;
    h.setDownstream(() => { calls++; return new Response("rejected", { status }); });
    await expect(upload()).rejects.toThrow(`(${status})`);
    expect(calls).toBe(1);
    expect(h.mintCount).toBe(1);
  });

  it("fails on a second 401 without leaking the authentication body or retrying again", async () => {
    let calls = 0;
    const sensitive = crypto.randomUUID();
    h.setDownstream(() => { calls++; return new Response(sensitive, { status: 401 }); });
    await expect(upload()).rejects.toThrow("Storage upload failed (401): authentication rejected");
    expect(calls).toBe(2);
    expect(h.mintCount).toBe(2);
    await h.provider.getAccessToken(); // The second rejected token is not cached.
    expect(h.mintCount).toBe(3);
  });

  it.each([new Error("connection reset"), new DOMException("deadline", "TimeoutError")])(
    "does not replay an ambiguous transport failure: %s", async (failure) => {
      const original = globalThis.fetch;
      await h.provider.getAccessToken();
      let calls = 0;
      globalThis.fetch = (async () => { calls++; throw failure; }) as unknown as typeof fetch;
      try {
        await expect(upload()).rejects.toThrow(failure.message);
        expect(calls).toBe(1);
        expect(h.mintCount).toBe(1);
      } finally { globalThis.fetch = original; }
    },
  );

  it("shares one refresh across concurrent 401s and ignores a delayed old-token rejection", async () => {
    const old = await h.provider.getAccessToken();
    const allStarted = deferred<void>();
    const release = deferred<void>();
    let oldCalls = 0;
    let total = 0;
    h.setDownstream(async (req) => {
      total++;
      if (req.headers.get("authorization") === `Bearer ${old}`) {
        oldCalls++;
        const index = new URL(req.url).searchParams.get("key");
        if (oldCalls === 8) allStarted.resolve();
        await allStarted.promise;
        if (index === "7") await release.promise;
        return new Response(null, { status: 401 });
      }
      return Response.json({ data: { url: "uploaded" } });
    });
    const operations = Array.from({ length: 8 }, (_, i) => storage().upload("skills", String(i), bytes, "application/zip"));
    await Promise.all(operations.slice(0, 7));
    expect(h.mintCount).toBe(2);
    release.resolve();
    await operations[7];
    expect(total).toBe(16);
    expect(h.mintCount).toBe(2);
    expect(await h.provider.getAccessToken()).toBe(h.tokens[1]!);
  });

  it("shares initial acquisition and releases a failed acquisition for later recovery", async () => {
    h.setMint(() => new Response(h.credentials.clientSecret, { status: 401 }));
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => h.provider.getAccessToken()));
    expect(h.mintCount).toBe(1);
    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.message).toBe("SA token acquisition failed (401)");
    }
    h.setMint(() => Response.json({ access_token: crypto.randomUUID() }));
    await h.provider.getAccessToken();
    expect(h.mintCount).toBe(2);
  });

  it.each([null, {}, { access_token: 3 }, { access_token: " " }, { access_token: "test", expires_in: -1 }, { access_token: "test", expires_in: "900" }])(
    "refuses malformed token responses", async (body) => {
      h.setMint(() => Response.json(body));
      await expect(h.provider.getAccessToken()).rejects.toThrow("Invalid SA token response");
    },
  );

  it("redacts non-JSON authentication responses", async () => {
    h.setMint(() => new Response(h.credentials.clientSecret));
    await expect(h.provider.getAccessToken()).rejects.toThrow("Invalid SA token response");
  });

  it("refuses absent credentials before network access", async () => {
    const provider = new NyxidSaTokenProvider(async () => ({ tokenUrl: "", clientId: "", clientSecret: "" }));
    await expect(provider.getAccessToken()).rejects.toThrow("not configured");
    expect(h.mintCount).toBe(0);
  });
});
