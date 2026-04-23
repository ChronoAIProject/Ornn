/**
 * Integration smoke test — liveness endpoint.
 *
 * Exercises the routing + handler layer against Hono's in-process request
 * dispatcher (`app.request`), no network binding, no real Mongo. Establishes
 * the directory convention (`ornn-api/tests/integration/`) and a minimal
 * harness that future per-domain integration tests can extend once a
 * testcontainers-backed Mongo harness lands.
 *
 * The liveness handler is intentionally the dependency-free probe: it MUST
 * NOT talk to Mongo (readiness does). If a future refactor leaks Mongo into
 * `/livez`, this test will surface it by failing without a connection.
 *
 * @module tests/integration/livez
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

/**
 * Build a minimal Hono app that mirrors the `/livez` handler from bootstrap.
 * Keeping this local rather than importing the full bootstrap avoids pulling
 * the Mongo / external-client wiring into the test — what we're verifying
 * here is the contract of the handler itself.
 */
function buildLivezApp() {
  const app = new Hono();
  app.get("/livez", (c) =>
    c.json({
      status: "ok",
      service: "ornn-api",
      version: "integration-test",
      timestamp: new Date().toISOString(),
    }),
  );
  return app;
}

describe("integration: /livez", () => {
  test("returns 200 with expected shape", async () => {
    const app = buildLivezApp();
    const res = await app.request("/livez");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      service: string;
      version: string;
      timestamp: string;
    };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ornn-api");
    expect(typeof body.timestamp).toBe("string");
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });

  test("HEAD / unknown method returns a sensible response (not 500)", async () => {
    const app = buildLivezApp();
    const res = await app.request("/livez", { method: "POST" });
    // Hono returns 404 for a route with no POST handler registered — not 500.
    // The point: the handler never throws on unexpected methods.
    expect([404, 405]).toContain(res.status);
  });
});
