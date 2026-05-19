/**
 * Tests for the Idempotency-Key middleware (#459).
 *
 * Uses an in-memory Mongo via `mongodb-memory-server` so the TTL index
 * + duplicate-key behaviour matches production. The handler being
 * wrapped is a counter that increments on every real execution — the
 * counter is the canary that tells us whether replay actually
 * short-circuited the handler (counter stays at 1) or re-ran it
 * (counter goes to 2+).
 *
 * @module middleware/idempotency.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import {
  IdempotencyKeyRepository,
  idempotencyMiddleware,
  MAX_IDEMPOTENCY_KEY_LENGTH,
} from "./idempotency";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let repo: IdempotencyKeyRepository;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("idempotency_test");
  repo = new IdempotencyKeyRepository(db);
  await repo.ensureIndexes();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

beforeEach(async () => {
  await db.collection("idempotency_keys").deleteMany({});
});

function makeApp(handler: (counter: { value: number }) => Promise<Response> | Response) {
  const counter = { value: 0 };
  const app = new Hono();
  // Stub auth so the middleware can scope keys per user.
  app.use("*", async (c, next) => {
    const userHeader = c.req.header("x-test-user") ?? "u1";
    c.set("auth" as never, { userId: userHeader } as never);
    await next();
  });
  app.use("*", idempotencyMiddleware({ repo }));
  app.all("/api/v1/skills", async (c) => {
    counter.value += 1;
    return handler(counter);
  });
  return { app, counter };
}

describe("idempotency middleware (#459)", () => {
  test("GET requests bypass the cache entirely (no key required, no doc written)", async () => {
    const { app, counter } = makeApp(() => new Response("ok", { status: 200 }));
    await app.request("/api/v1/skills", { method: "GET" });
    await app.request("/api/v1/skills", { method: "GET" });
    expect(counter.value).toBe(2);
    expect(await db.collection("idempotency_keys").countDocuments()).toBe(0);
  });

  test("POST without an Idempotency-Key header is uncached", async () => {
    const { app, counter } = makeApp(() => new Response("ok", { status: 200 }));
    await app.request("/api/v1/skills", { method: "POST" });
    await app.request("/api/v1/skills", { method: "POST" });
    expect(counter.value).toBe(2);
    expect(await db.collection("idempotency_keys").countDocuments()).toBe(0);
  });

  test("identical POST + key returns the cached body and skips the handler (the core feature)", async () => {
    const { app, counter } = makeApp((c) =>
      new Response(JSON.stringify({ id: `skill-${c.value}` }), {
        status: 201,
        headers: { "Content-Type": "application/json", Location: "/v1/skills/abc" },
      }),
    );
    const headers = { "Idempotency-Key": "key-abc-123" };
    const first = await app.request("/api/v1/skills", { method: "POST", headers });
    const second = await app.request("/api/v1/skills", { method: "POST", headers });

    expect(counter.value).toBe(1);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toEqual({ id: "skill-1" });
    expect(await second.json()).toEqual({ id: "skill-1" });
    expect(second.headers.get("Idempotency-Replay")).toBe("true");
    expect(first.headers.get("Idempotency-Replay")).toBe(null);
    // Cached headers round-trip (Location was set by the handler).
    expect(second.headers.get("Location")).toBe("/v1/skills/abc");
  });

  test("different users with the same key DON'T collide (per-user scoping)", async () => {
    const { app, counter } = makeApp((c) =>
      new Response(JSON.stringify({ id: c.value }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const key = "shared-key";
    const a = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Idempotency-Key": key, "x-test-user": "alice" },
    });
    const b = await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Idempotency-Key": key, "x-test-user": "bob" },
    });
    expect(counter.value).toBe(2);
    expect(await a.json()).toEqual({ id: 1 });
    expect(await b.json()).toEqual({ id: 2 });
    expect(b.headers.get("Idempotency-Replay")).toBe(null);
  });

  test("different paths with the same key DON'T collide", async () => {
    const counter = { value: 0 };
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth" as never, { userId: "u1" } as never);
      await next();
    });
    app.use("*", idempotencyMiddleware({ repo }));
    app.post("/api/v1/skills", async () => {
      counter.value += 1;
      return new Response(JSON.stringify({ kind: "skill", n: counter.value }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    app.post("/api/v1/tags", async () => {
      counter.value += 1;
      return new Response(JSON.stringify({ kind: "tag", n: counter.value }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const headers = { "Idempotency-Key": "k" };
    const skill = await app.request("/api/v1/skills", { method: "POST", headers });
    const tag = await app.request("/api/v1/tags", { method: "POST", headers });
    expect(counter.value).toBe(2);
    expect((await skill.json()) as { kind: string; n: number }).toEqual({ kind: "skill", n: 1 });
    expect((await tag.json()) as { kind: string; n: number }).toEqual({ kind: "tag", n: 2 });
  });

  test("4xx responses ARE cached (the client should see the same validation error on retry)", async () => {
    const { app, counter } = makeApp((c) =>
      new Response(JSON.stringify({ code: "validation_error", n: c.value }), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    const headers = { "Idempotency-Key": "k" };
    const first = await app.request("/api/v1/skills", { method: "POST", headers });
    const second = await app.request("/api/v1/skills", { method: "POST", headers });
    expect(counter.value).toBe(1);
    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(second.headers.get("Idempotency-Replay")).toBe("true");
  });

  test("5xx responses are NOT cached (transient — let the next retry hit the handler)", async () => {
    const { app, counter } = makeApp((c) =>
      new Response(JSON.stringify({ code: "internal_error", n: c.value }), {
        status: 500,
        headers: { "Content-Type": "application/problem+json" },
      }),
    );
    const headers = { "Idempotency-Key": "k" };
    await app.request("/api/v1/skills", { method: "POST", headers });
    await app.request("/api/v1/skills", { method: "POST", headers });
    expect(counter.value).toBe(2);
    expect(await db.collection("idempotency_keys").countDocuments()).toBe(0);
  });

  test("204 No Content replays cleanly (empty body, no content-type)", async () => {
    const { app, counter } = makeApp(() => new Response(null, { status: 204 }));
    const headers = { "Idempotency-Key": "k" };
    const first = await app.request("/api/v1/skills", { method: "DELETE", headers });
    const second = await app.request("/api/v1/skills", { method: "DELETE", headers });
    expect(counter.value).toBe(1);
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(second.headers.get("Idempotency-Replay")).toBe("true");
  });

  test("oversize keys are silently bypassed (do not 400 every caller as soon as the middleware ships)", async () => {
    const { app, counter } = makeApp(() => new Response("ok", { status: 200 }));
    const oversize = "x".repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);
    await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Idempotency-Key": oversize },
    });
    await app.request("/api/v1/skills", {
      method: "POST",
      headers: { "Idempotency-Key": oversize },
    });
    expect(counter.value).toBe(2);
    expect(await db.collection("idempotency_keys").countDocuments()).toBe(0);
  });

  test("TTL index is created with the documented 24h window", async () => {
    const indexes = await db.collection("idempotency_keys").indexes();
    const ttl = indexes.find((i) => i.name === "createdAt_ttl");
    expect(ttl).toBeDefined();
    expect(ttl?.expireAfterSeconds).toBe(24 * 60 * 60);
  });

  test("handler errors that don't produce a response don't pollute the cache", async () => {
    // Hono catches thrown errors via `app.onError`. With no `onError`
    // configured, a thrown error surfaces as a default 500 page — which
    // is 5xx, which we already don't cache. Pin that explicitly so a
    // future change to error handling can't sneak through.
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth" as never, { userId: "u1" } as never);
      await next();
    });
    app.use("*", idempotencyMiddleware({ repo }));
    app.post("/api/v1/skills", () => {
      throw new Error("boom");
    });
    const headers = { "Idempotency-Key": "k" };
    await app.request("/api/v1/skills", { method: "POST", headers });
    expect(await db.collection("idempotency_keys").countDocuments()).toBe(0);
  });
});
