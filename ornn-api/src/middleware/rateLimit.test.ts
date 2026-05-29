/**
 * Tests for the sliding-window rate-limit middleware (#439 + #460).
 *
 * Pins:
 *   - RFC 9239 headers emitted on every response (allowed + denied)
 *   - 429 response with Retry-After when the cap is exceeded
 *   - Per-user keying defaults work (no collision between users)
 *   - Window resets after the configured interval
 *
 * @module middleware/rateLimit.test
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { AppError } from "../shared/types/index";
import { __resetRateLimitForTests, rateLimit } from "./rateLimit";
import { buildProblemJsonBody } from "../shared/types/index";

function makeApp(opts: {
  windowMs?: number;
  max?: number;
  label?: string;
} = {}) {
  const app = new Hono();
  // Stub auth so the default keyBy can find a user id.
  app.use("*", async (c, next) => {
    const user = c.req.header("x-test-user") ?? "u1";
    c.set("auth" as never, { userId: user } as never);
    await next();
  });
  app.use(
    "*",
    rateLimit({
      windowMs: opts.windowMs ?? 60_000,
      max: opts.max ?? 3,
      label: opts.label ?? "test",
    }),
  );
  app.get("/", (c) => c.json({ ok: true }));
  // Translate AppError → 429 like the global handler does.
  app.onError((err, c) => {
    if (err instanceof AppError) {
      const body = buildProblemJsonBody({
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        instance: c.req.path,
        requestId: null,
      });
      return c.json(body, err.statusCode as never, {
        "Content-Type": "application/problem+json",
      });
    }
    return c.json({ error: { code: "internal_error", message: String(err) } }, 500);
  });
  return app;
}

describe("rateLimit middleware (#439 + #460)", () => {
  beforeEach(() => __resetRateLimitForTests());

  test("emits RFC 9239 headers on every allowed response", async () => {
    const app = makeApp({ max: 3 });
    const res = await app.request("/", { headers: { "x-test-user": "alice" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("3");
    expect(res.headers.get("RateLimit-Remaining")).toBe("2");
    const reset = Number(res.headers.get("RateLimit-Reset"));
    expect(reset).toBeGreaterThan(0);
    expect(reset).toBeLessThanOrEqual(60);
  });

  test("decrements Remaining across consecutive requests by the same user", async () => {
    const app = makeApp({ max: 3 });
    const headers = { "x-test-user": "bob" };
    const r1 = await app.request("/", { headers });
    const r2 = await app.request("/", { headers });
    const r3 = await app.request("/", { headers });
    expect(r1.headers.get("RateLimit-Remaining")).toBe("2");
    expect(r2.headers.get("RateLimit-Remaining")).toBe("1");
    expect(r3.headers.get("RateLimit-Remaining")).toBe("0");
  });

  test("returns 429 with Retry-After + problem+json when the cap is exceeded", async () => {
    const app = makeApp({ max: 2 });
    const headers = { "x-test-user": "charlie" };
    await app.request("/", { headers });
    await app.request("/", { headers });
    const denied = await app.request("/", { headers });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Content-Type")).toContain("application/problem+json");
    expect(denied.headers.get("Retry-After")).not.toBeNull();
    expect(denied.headers.get("RateLimit-Remaining")).toBe("0");
    const body = (await denied.json()) as { code: string; status: number };
    expect(body.code).toBe("rate_limited");
    expect(body.status).toBe(429);
  });

  test("different users share separate buckets (per-user keying)", async () => {
    const app = makeApp({ max: 1 });
    const aliceFirst = await app.request("/", { headers: { "x-test-user": "alice" } });
    expect(aliceFirst.status).toBe(200);
    // Alice is now at her cap; Bob shouldn't be affected.
    const bobFirst = await app.request("/", { headers: { "x-test-user": "bob" } });
    expect(bobFirst.status).toBe(200);
    expect(bobFirst.headers.get("RateLimit-Remaining")).toBe("0");
    // Alice's second hit fails.
    const aliceSecond = await app.request("/", { headers: { "x-test-user": "alice" } });
    expect(aliceSecond.status).toBe(429);
  });

  test("window resets after windowMs", async () => {
    const app = makeApp({ max: 2, windowMs: 50 });
    const headers = { "x-test-user": "dave" };
    await app.request("/", { headers });
    await app.request("/", { headers });
    const denied = await app.request("/", { headers });
    expect(denied.status).toBe(429);
    // Wait past the window
    await new Promise((r) => setTimeout(r, 60));
    const allowed = await app.request("/", { headers });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("RateLimit-Remaining")).toBe("1");
  });

  test("different labels share separate buckets (multi-limit composition)", async () => {
    // Two limiters on the same user with different labels.
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("auth" as never, { userId: "eve" } as never);
      await next();
    });
    app.use("*", rateLimit({ windowMs: 60_000, max: 2, label: "burst" }));
    app.use("*", rateLimit({ windowMs: 60_000, max: 10, label: "daily" }));
    app.get("/", (c) => c.json({ ok: true }));
    app.onError((err, c) => {
      if (err instanceof AppError) return c.json({ code: err.code }, err.statusCode as never);
      return c.json({ code: "internal_error" }, 500);
    });
    // Hit the route 3 times — third should fail on the burst limit
    // even though daily allows 10.
    await app.request("/");
    await app.request("/");
    const r3 = await app.request("/");
    expect(r3.status).toBe(429);
  });
});
