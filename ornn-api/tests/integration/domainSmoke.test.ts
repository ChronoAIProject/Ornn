/**
 * Integration smoke tests — one per domain.
 *
 * Each test exercises the full routing + middleware + Mongo stack for a
 * domain: if a request survives the chain without a 500, the wiring is
 * intact. The tests deliberately hit endpoints whose dependencies are
 * local (Mongo + auth middleware) so external services (NyxID, storage,
 * sandbox) are never contacted.
 *
 * Uses Hono's `app.request()` in-process dispatcher — no port bind, no
 * network. Shared harness instance keeps the suite fast (~2s Mongo boot
 * amortized across all tests).
 *
 * @module tests/integration/domainSmoke
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startHarness, authHeaders, type Harness } from "./harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness.cleanup();
});

describe("integration: health probes", () => {
  test("GET /livez returns 200 with service metadata", async () => {
    const res = await harness.app.request("/livez");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("ornn-api");
  });

  test("GET /readyz pings Mongo and returns 200 when reachable", async () => {
    const res = await harness.app.request("/readyz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; mongoLatencyMs: number };
    expect(body.status).toBe("ready");
    expect(typeof body.mongoLatencyMs).toBe("number");
    expect(body.mongoLatencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("integration: OpenAPI spec", () => {
  test("GET /api/v1/openapi.json returns a valid spec", async () => {
    const res = await harness.app.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title.toLowerCase()).toContain("ornn");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });
});

describe("integration: domain — skills", () => {
  test("GET /api/v1/skills/:unknown returns 404 (route + Mongo wired)", async () => {
    // Use a syntactically-valid-looking ID the handler will try to fetch.
    const res = await harness.app.request(
      "/api/v1/skills/000000000000000000000000",
      { headers: authHeaders({ userId: "user_smoke", email: "smoke@test" }) },
    );
    // Valid outcomes: 404 (not found) or 400 (invalid id format). A 500
    // would mean the route/handler/db path is broken.
    expect([400, 404]).toContain(res.status);
  });
});

describe("integration: domain — skill search", () => {
  test("GET /api/v1/skill-search returns an envelope", async () => {
    const res = await harness.app.request(
      "/api/v1/skill-search?q=anything",
      { headers: authHeaders({ userId: "user_smoke", email: "smoke@test" }) },
    );
    // Empty DB should still yield a well-formed response — 200 with an
    // empty items array, or a 4xx validation error. Never 500.
    expect(res.status).toBeLessThan(500);
  });
});

describe("integration: domain — admin", () => {
  test("GET /api/v1/admin/activities rejects callers without admin perm", async () => {
    const res = await harness.app.request(
      "/api/v1/admin/activities",
      { headers: authHeaders({ userId: "user_not_admin", email: "n@test" }) },
    );
    expect([401, 403]).toContain(res.status);
  });

  test("GET /api/v1/admin/activities accepts platform admins", async () => {
    const res = await harness.app.request("/api/v1/admin/activities", {
      headers: authHeaders({
        userId: "user_admin",
        email: "a@test",
        permissions: ["ornn:admin:skill"],
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe("integration: domain — me", () => {
  test("GET /api/v1/me echoes the caller identity", async () => {
    const res = await harness.app.request("/api/v1/me", {
      headers: authHeaders({
        userId: "user_me",
        email: "me@test",
        displayName: "Me",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string } };
    expect(body.data.userId).toBe("user_me");
  });
});

describe("integration: domain — users", () => {
  test("GET /api/v1/users/search is reachable", async () => {
    const res = await harness.app.request("/api/v1/users/search?q=abc", {
      headers: authHeaders({ userId: "user_smoke", email: "smoke@test" }),
    });
    // Empty Mongo means empty result set — 200 with empty items is the
    // expected well-formed response; anything 500+ indicates broken wiring.
    expect(res.status).toBeLessThan(500);
  });
});

describe("integration: domain — playground", () => {
  test("POST /api/v1/playground/chat rejects without auth", async () => {
    const res = await harness.app.request("/api/v1/playground/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // No auth headers → proxy auth middleware leaves c.var.auth unset →
    // require-permission rejects. 401 or 403 both acceptable.
    expect([401, 403]).toContain(res.status);
  });
});

describe("integration: domain — skill format", () => {
  test("GET /api/v1/skill-format/rules returns the rules doc", async () => {
    const res = await harness.app.request("/api/v1/skill-format/rules", {
      headers: authHeaders({ userId: "user_smoke", email: "smoke@test" }),
    });
    // Format rules are served from an in-process markdown file — should
    // return a 200 regardless of DB state.
    expect(res.status).toBe(200);
  });
});
