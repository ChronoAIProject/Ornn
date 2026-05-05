/**
 * Integration-shaped tests for `auditMiddleware`. These run a real
 * Hono app with the middleware in place and stub the dependencies
 * (repository, body storage) so we can assert on what the middleware
 * decides to persist without spinning up Mongo or MinIO.
 *
 * For the wider failure-isolation tests (Mongo down / MinIO down / mid-
 * pipeline throw) we still use the same in-process stubs but configure
 * them to throw on every operation. The contract is that none of those
 * failures propagate to the business response.
 */

import { describe, test, expect, mock } from "bun:test";
import { Hono } from "hono";
import { auditMiddleware } from "./middleware";
import type { IAuditBodyStorage } from "./bodyStorage";
import type { ApiAuditRepository } from "./repository";
import type { AuditDocument } from "./types";
import { setAuditConfig } from "./index";
import type { AuditVariables } from "./types";
import pino from "pino";

const silentLogger = pino({ level: "silent" });

function makeRepo(opts?: { throwOnInsert?: boolean }) {
  const inserts: AuditDocument[] = [];
  const insert = mock(async (doc: AuditDocument) => {
    if (opts?.throwOnInsert) {
      throw new Error("simulated mongo down");
    }
    inserts.push(doc);
  });
  return { repo: { insert } as unknown as ApiAuditRepository, inserts, insertSpy: insert };
}

function makeStorage(opts?: { throwOnPut?: boolean; large?: boolean }) {
  const puts: Array<{ auditId: string; side: string; body: unknown }> = [];
  const put = mock(async (input: { auditId: string; side: "req" | "res"; body: unknown }) => {
    if (opts?.throwOnPut) {
      throw new Error("simulated minio down");
    }
    puts.push(input);
    return { key: `2026/01/09/${input.auditId}-${input.side}.json.gz` };
  });
  return { storage: { put } as unknown as IAuditBodyStorage, puts };
}

function buildApp(deps: {
  repo: ApiAuditRepository;
  storage: IAuditBodyStorage;
  bodyInlineMaxBytes?: number;
  authShape?: { hasAuth: boolean; hasForwardedUserToken: boolean; identity: string | null };
}) {
  const app = new Hono<{ Variables: AuditVariables }>();
  app.use(
    "*",
    auditMiddleware({
      repository: deps.repo,
      bodyStorage: deps.storage,
      bodyInlineMaxBytes: deps.bodyInlineMaxBytes ?? 16 * 1024,
      extraBlacklistPatterns: [],
      logger: silentLogger,
      resolveAuthHint: () => ({
        hasAuth: deps.authShape?.hasAuth ?? false,
        hasForwardedUserToken: deps.authShape?.hasForwardedUserToken ?? false,
        callerIdentity: deps.authShape?.identity ?? null,
      }),
    }),
  );
  return app;
}

describe("auditMiddleware: write op (POST) — full body capture", () => {
  test("inserts an audit doc with whitelisted fields preserved", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({ repo, storage });
    app.post("/api/v1/skills", async (c) => {
      setAuditConfig(c, { req: ["skillName"], res: ["skillId"] });
      return c.json({ skillId: "sk_42", trace: "should-be-redacted" }, 201);
    });

    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ornn-caller": "web",
      },
      body: JSON.stringify({ skillName: "alpha", token: "leak-me" }),
    });
    expect(res.status).toBe(201);

    // Wait one microtask so the fire-and-forget audit completes.
    await new Promise((r) => setImmediate(r));
    expect(inserts).toHaveLength(1);
    const d = inserts[0]!;
    expect(d.method).toBe("POST");
    expect(d.status).toBe(201);
    expect(d.callerType).toBe("anonymous"); // no auth shape stubbed
    expect(d.reqBodyRef).toEqual({
      kind: "inline",
      data: { skillName: "alpha", token: "[REDACTED]" },
    });
    expect(d.resBodyRef).toEqual({
      kind: "inline",
      data: { skillId: "sk_42", trace: "[REDACTED]" },
    });
    expect(d.redactedFields).toContain("token");
    expect(d.redactedFields).toContain("trace");
  });
});

describe("auditMiddleware: read 200 — metadata only", () => {
  test("body refs left null on a 200 GET", async () => {
    const { repo, inserts } = makeRepo();
    const { storage, puts } = makeStorage();
    const app = buildApp({ repo, storage });
    app.get("/api/v1/skills/:id", (c) => c.json({ id: c.req.param("id"), name: "x" }));

    const res = await app.request("/api/v1/skills/sk_1");
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(inserts).toHaveLength(1);
    const d = inserts[0]!;
    expect(d.reqBodyRef).toBeNull();
    expect(d.resBodyRef).toBeNull();
    expect(puts).toHaveLength(0);
  });
});

describe("auditMiddleware: 4xx response — body kept even on a GET", () => {
  test("404 GET still records both bodies", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({ repo, storage });
    app.get("/api/v1/skills/:id", (c) =>
      c.json({ data: null, error: { code: "NOT_FOUND", message: "x" } }, 404),
    );

    const res = await app.request("/api/v1/skills/missing");
    expect(res.status).toBe(404);
    await new Promise((r) => setImmediate(r));

    const d = inserts[0]!;
    expect(d.status).toBe(404);
    expect(d.resBodyRef?.kind).toBe("inline");
  });
});

describe("auditMiddleware: large body offload", () => {
  test("body bigger than inline cap goes to MinIO", async () => {
    const { repo, inserts } = makeRepo();
    const { storage, puts } = makeStorage();
    const app = buildApp({ repo, storage, bodyInlineMaxBytes: 64 });
    app.post("/api/v1/skills", async (c) => {
      setAuditConfig(c, { req: ["bigField"], res: ["bigField"] });
      const big = "x".repeat(2_000);
      return c.json({ bigField: big }, 201);
    });

    const big = "y".repeat(2_000);
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bigField: big }),
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setImmediate(r));

    const d = inserts[0]!;
    expect(d.reqBodyRef?.kind).toBe("minio");
    expect(d.resBodyRef?.kind).toBe("minio");
    expect(puts).toHaveLength(2);
  });

  test("MinIO failure marks bodyOffloadFailed=true but still inserts the doc", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage({ throwOnPut: true });
    const app = buildApp({ repo, storage, bodyInlineMaxBytes: 64 });
    app.post("/api/v1/skills", async (c) => {
      setAuditConfig(c, { req: ["bigField"], res: ["bigField"] });
      const big = "x".repeat(2_000);
      return c.json({ bigField: big }, 201);
    });

    const big = "y".repeat(2_000);
    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bigField: big }),
    });
    // The business response must NEVER be impacted by MinIO failure.
    expect(res.status).toBe(201);
    await new Promise((r) => setImmediate(r));

    const d = inserts[0]!;
    expect(d.reqBodyRef).toBeNull();
    expect(d.resBodyRef).toBeNull();
    expect(d.bodyOffloadFailed).toBe(true);
  });
});

describe("auditMiddleware: failure isolation — mongo down / pipeline throw", () => {
  test("repository throw does not impact the business response", async () => {
    const { repo } = makeRepo({ throwOnInsert: true });
    const { storage } = makeStorage();
    const app = buildApp({ repo, storage });
    app.get("/api/v1/anything", (c) => c.json({ ok: true }));

    const res = await app.request("/api/v1/anything");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("body storage throw on write op does not impact the business response", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage({ throwOnPut: true });
    const app = buildApp({ repo, storage, bodyInlineMaxBytes: 1 });
    app.post("/api/v1/skills", (c) => c.json({ skillId: "ok" }, 201));

    const res = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillName: "alpha" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ skillId: "ok" });
    await new Promise((r) => setImmediate(r));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.bodyOffloadFailed).toBe(true);
  });

  test("identity-bearing headers never appear in the persisted doc", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({ repo, storage });
    app.post("/api/v1/skills", (c) => c.json({ id: "x" }, 201));

    await app.request("/api/v1/skills", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer leak-token",
        "cookie": "session=leak",
        "x-nyxid-user-id": "u_42",
      },
      body: JSON.stringify({ a: 1 }),
    });
    await new Promise((r) => setImmediate(r));

    // The audit doc has no `headers` field at all (per spec — we don't
    // persist headers). The serialized doc must not contain any of
    // the sensitive header values.
    const serialized = JSON.stringify(inserts[0]);
    expect(serialized.includes("leak-token")).toBe(false);
    expect(serialized.includes("session=leak")).toBe(false);
    expect(serialized.includes("u_42")).toBe(false);
  });
});

describe("auditMiddleware: caller-type captures", () => {
  test("authenticated browser session → callerType=web, identity recorded", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({
      repo,
      storage,
      authShape: { hasAuth: true, hasForwardedUserToken: false, identity: "u_alice" },
    });
    app.get("/api/v1/me", (c) => c.json({ ok: true }));

    await app.request("/api/v1/me", {
      headers: { "x-ornn-caller": "web" },
    });
    await new Promise((r) => setImmediate(r));

    expect(inserts[0]!.callerType).toBe("web");
    expect(inserts[0]!.callerIdentity).toBe("u_alice");
    expect(inserts[0]!.callerTypeMismatch).toBe(false);
  });

  test("agent flow with web header hint → mismatch=true, no impact on response", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({
      repo,
      storage,
      authShape: { hasAuth: true, hasForwardedUserToken: true, identity: "u_bob" },
    });
    app.get("/api/v1/skills", (c) => c.json({ items: [] }));

    const res = await app.request("/api/v1/skills", {
      headers: { "x-ornn-caller": "web" },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(inserts[0]!.callerType).toBe("agent");
    expect(inserts[0]!.callerTypeMismatch).toBe(true);
  });
});

describe("auditMiddleware: IP truncation in persisted record", () => {
  test("X-Forwarded-For first entry is truncated", async () => {
    const { repo, inserts } = makeRepo();
    const { storage } = makeStorage();
    const app = buildApp({ repo, storage });
    app.get("/api/v1/anything", (c) => c.json({ ok: true }));

    await app.request("/api/v1/anything", {
      headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
    });
    await new Promise((r) => setImmediate(r));
    expect(inserts[0]!.sourceIp).toBe("203.0.113.0");
  });
});
