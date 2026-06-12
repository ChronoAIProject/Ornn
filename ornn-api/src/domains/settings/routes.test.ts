/**
 * Route-level tests for the per-section admin settings bundle
 * (`GET`/`PUT` per section).
 *
 * Harness: a fake `SettingsService` (only `getSection`/`putSection` are
 * exercised by the routes) mounted under a Hono app whose auth context
 * is pre-set and whose onError emits the RFC 7807 envelope.
 *
 * Covers:
 *   - GET on a section with secret fields (mirror) mid-masks the secret
 *     — plaintext absent from the body.
 *   - GET on a no-secret section (playground) returns the value
 *     verbatim (the `secretFields.length === 0` early return).
 *   - PUT echoes `meta.changedFields` from the service result.
 *   - PUT's `currentActor` falls back to `unknown`/`unknown@local` when
 *     the auth context lacks userId/email.
 *   - PUT with a non-object body → 400 invalid_body.
 *
 * @module domains/settings/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { isMidMaskSentinel } from "../../infra/crypto";
import { buildProblemJsonBody } from "../../shared/types/index";
import { createSettingsRoutes } from "./routes";
import type { SettingsActor, SettingsService } from "./types";

const SECRET_PLAINTEXT = "-----BEGIN PRIVATE KEY-----\nABCDEFGHIJKLMNOP\n-----END-----";

/**
 * Minimal SettingsService fake. Records the last `putSection` call so a
 * test can assert the actor the route resolved. Only the two methods the
 * routes call are implemented; the rest throw if ever reached.
 */
class FakeSettingsService implements Partial<SettingsService> {
  lastPutActor: SettingsActor | null = null;
  sectionValues = new Map<string, Record<string, unknown>>();

  async getSection<T>(id: string): Promise<T> {
    return (this.sectionValues.get(id) ?? {}) as T;
  }

  async putSection<T>(
    id: string,
    value: T,
    actor: SettingsActor,
  ): Promise<{ value: T; changedFields: ReadonlyArray<string> }> {
    this.lastPutActor = actor;
    this.sectionValues.set(id, value as Record<string, unknown>);
    return { value, changedFields: ["enabled", "appPrivateKey"] };
  }
}

/**
 * Mount the settings routes with a pre-set auth context. `auth` defaults
 * to a full admin identity; pass a partial to exercise the
 * `currentActor` fallback. Always includes the admin permission so the
 * `adminGuard` lets the request through.
 */
function makeApp(auth: Record<string, unknown> = {
  userId: "u-admin",
  email: "admin@test.local",
  displayName: "Admin",
}) {
  const svc = new FakeSettingsService();
  const routes = createSettingsRoutes({
    settingsService: svc as unknown as SettingsService,
  });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, {
      ...auth,
      permissions: ["ornn:admin:skill"],
    } as never);
    await next();
  });
  app.route("/api/v1", routes);
  app.onError((err, c) => {
    const code = (err as { code?: string }).code ?? "internal_error";
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = buildProblemJsonBody({
      statusCode: status,
      code,
      message: err.message,
      instance: c.req.path,
      requestId: null,
    });
    return c.json(body, status as never, {
      "Content-Type": "application/problem+json",
    });
  });
  return { app, svc };
}

describe("Settings admin routes", () => {
  it("GET mirror: mid-masks the secret field, plaintext absent", async () => {
    const { app, svc } = makeApp();
    svc.sectionValues.set("mirror", {
      enabled: true,
      owner: "ChronoAIProject",
      appPrivateKey: SECRET_PLAINTEXT,
    });
    const res = await app.request("/api/v1/admin/settings/mirror");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes(SECRET_PLAINTEXT)).toBe(false);
    const body = JSON.parse(text) as {
      data: { appPrivateKey: string; owner: string };
    };
    expect(isMidMaskSentinel(body.data.appPrivateKey)).toBe(true);
    // Non-secret field passes through untouched.
    expect(body.data.owner).toBe("ChronoAIProject");
  });

  it("GET playground: no-secret section returns value verbatim", async () => {
    const { app, svc } = makeApp();
    svc.sectionValues.set("playground", {
      defaultMonthlyQuota: 200,
      defaultModelId: "gpt-4o",
    });
    const res = await app.request("/api/v1/admin/settings/playground");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { defaultMonthlyQuota: number; defaultModelId: string };
    };
    expect(body.data.defaultMonthlyQuota).toBe(200);
    expect(body.data.defaultModelId).toBe("gpt-4o");
  });

  it("PUT: echoes meta.changedFields from the service", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/admin/settings/mirror", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false, appPrivateKey: "new-secret" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // The just-submitted plaintext must never round-trip in the response.
    expect(text.includes("new-secret")).toBe(false);
    const body = JSON.parse(text) as {
      meta: { changedFields: string[] };
      data: { appPrivateKey: string };
    };
    expect(body.meta.changedFields).toEqual(["enabled", "appPrivateKey"]);
    // Response masks the secret on the way back out.
    expect(isMidMaskSentinel(body.data.appPrivateKey)).toBe(true);
  });

  it("PUT: currentActor falls back to unknown when auth lacks fields", async () => {
    // Auth context carries the admin permission (so adminGuard passes)
    // but no userId/email/displayName — currentActor must fill defaults.
    const { app, svc } = makeApp({});
    const res = await app.request("/api/v1/admin/settings/playground", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultMonthlyQuota: 300 }),
    });
    expect(res.status).toBe(200);
    expect(svc.lastPutActor?.userId).toBe("unknown");
    expect(svc.lastPutActor?.email).toBe("unknown@local");
    expect(svc.lastPutActor?.displayName).toBeUndefined();
  });

  it("PUT: non-object body → 400 invalid_body", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/admin/settings/playground", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("just a string"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_body");
  });
});
