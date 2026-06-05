/**
 * Route-level tests for the admin LLM-providers bundle + the `/me/models`
 * picker (Story 7.1 + #270).
 *
 * Harness: a real `LlmProvidersService` wired to an in-memory `FakeRepo`
 * and a `StubFetcher`, mounted under a Hono app whose auth context is
 * pre-set (production wires this via proxyAuthSetup) and whose onError
 * emits the RFC 7807 envelope. Every masked response asserts the
 * mid-mask sentinel form is present AND the raw plaintext secret is
 * absent.
 *
 * Also unit-tests `throwModelResolutionError` as a pure function across
 * all four `ModelResolution` kinds.
 *
 * @module domains/settings/llmProviders/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { isMidMaskSentinel } from "../../../infra/crypto";
import {
  LlmProvidersService,
  type ModelListFetcher,
  type ModelResolution,
  type Surface,
} from "./service";
import type { StoredProvider } from "./repository";
import { createLlmProvidersRoutes, createLlmPickerRoutes, throwModelResolutionError } from "./routes";
import { AppError, buildProblemJsonBody } from "../../../shared/types/index";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";

class FakeRepo {
  rows = new Map<string, StoredProvider>();
  async ensureIndexes() {}
  async list() {
    return [...this.rows.values()];
  }
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByName(name: string) {
    for (const r of this.rows.values()) if (r.name === name) return r;
    return null;
  }
  async insert(doc: StoredProvider) {
    this.rows.set(doc._id, doc);
  }
  async replace(id: string, doc: StoredProvider) {
    this.rows.set(id, doc);
  }
  async deleteById(id: string) {
    return this.rows.delete(id);
  }
  // patchModel needs this when a default flag is flipped on (matches the
  // in-memory implementation used by service.test.ts).
  async clearDefaultsForSurfaceExcept(
    surface: "Playground" | "SkillGen",
    keep: { providerId: string; modelId: string } | null,
  ): Promise<void> {
    const defKey =
      surface === "Playground" ? "defaultForPlayground" : "defaultForSkillGen";
    for (const [id, doc] of this.rows) {
      const isKeeper = keep && id === keep.providerId;
      const nextModels = doc.models.map((m) => {
        if (isKeeper && m.id === keep!.modelId) return m;
        if ((m as unknown as Record<string, unknown>)[defKey] !== true) return m;
        return { ...m, [defKey]: false };
      });
      this.rows.set(id, { ...doc, models: nextModels });
    }
  }
}

class StubFetcher implements ModelListFetcher {
  next: ReadonlyArray<{ id: string; displayName: string }> = [];
  async fetch() {
    return this.next;
  }
}

const ADMIN_AUTH = {
  userId: "u-admin",
  email: "admin@test.local",
  displayName: "Admin",
  permissions: ["ornn:admin:skill"],
};

/**
 * Build a service + a Hono app with the routes mounted under `/api/v1`,
 * a pre-set admin auth context, and the standard RFC 7807 onError. The
 * `sectionDefaultResolver` is optional so the picker tests can exercise
 * both the wired and the absent path.
 */
function makeApp(
  routeKind: "admin" | "picker" = "admin",
  opts: { sectionDefaultResolver?: (s: Surface) => Promise<string | null> } = {},
) {
  const repo = new FakeRepo();
  const fetcher = new StubFetcher();
  const svc = new LlmProvidersService({
    repo: repo as unknown as import("./repository").LlmProvidersRepository,
    encryptionKey: KEY,
    modelListFetcher: fetcher,
  });
  const routes =
    routeKind === "admin"
      ? createLlmProvidersRoutes({ llmProvidersService: svc })
      : createLlmPickerRoutes({
          llmProvidersService: svc,
          ...(opts.sectionDefaultResolver
            ? { sectionDefaultResolver: opts.sectionDefaultResolver }
            : {}),
        });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("auth" as never, ADMIN_AUTH as never);
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
  return { app, svc, repo, fetcher };
}

const PLAINTEXT = "sk-real-plaintext-secret-12345";

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "openai-test",
    gatewayUrl: "https://api.openai.com",
    modelListUrl: "https://api.openai.com/v1/models",
    apiFormat: "chat-completion",
    auth: { kind: "apiKey", apiKey: PLAINTEXT },
    models: [
      {
        id: "gpt-4o",
        displayName: "GPT-4o",
        enabledForPlayground: true,
        defaultForPlayground: true,
      },
    ],
    maxOutputTokens: 8192,
    defaultTemperature: 0.7,
    ...overrides,
  };
}

/** POST a provider through the route and return its id. */
async function seedProvider(app: Hono, body = providerBody()) {
  const res = await app.request("/api/v1/admin/settings/llm-providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { _id: string } }).data._id;
}

/** Assert a JSON text body masks the apiKey: sentinel present, plaintext gone. */
function assertMaskedApiKey(text: string) {
  expect(text.includes(PLAINTEXT)).toBe(false);
  const parsed = JSON.parse(text) as {
    data: { auth: { kind: string; apiKey: string } };
  };
  expect(parsed.data.auth.kind).toBe("apiKey");
  expect(isMidMaskSentinel(parsed.data.auth.apiKey)).toBe(true);
  expect(parsed.data.auth.apiKey).not.toBe(PLAINTEXT);
}

describe("LlmProviders admin routes", () => {
  it("POST: 201 body carries mid-masked apiKey, not plaintext", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/v1/admin/settings/llm-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(providerBody()),
    });
    expect(res.status).toBe(201);
    assertMaskedApiKey(await res.text());
  });

  it("GET list: returns every provider, masked", async () => {
    const { app } = makeApp();
    await seedProvider(app);
    const res = await app.request("/api/v1/admin/settings/llm-providers");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes(PLAINTEXT)).toBe(false);
    const parsed = JSON.parse(text) as {
      data: { items: Array<{ auth: { apiKey: string } }> };
    };
    expect(parsed.data.items).toHaveLength(1);
    expect(isMidMaskSentinel(parsed.data.items[0]!.auth.apiKey)).toBe(true);
  });

  it("GET /:id: 200 masked for a known provider", async () => {
    const { app } = makeApp();
    const id = await seedProvider(app);
    const res = await app.request(`/api/v1/admin/settings/llm-providers/${id}`);
    expect(res.status).toBe(200);
    assertMaskedApiKey(await res.text());
  });

  it("GET /:id: 404 provider_not_found for an unknown id", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/api/v1/admin/settings/llm-providers/does-not-exist",
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("provider_not_found");
  });

  it("PUT /:id: 200 masked echo, plaintext absent", async () => {
    const { app } = makeApp();
    const id = await seedProvider(app);
    const res = await app.request(`/api/v1/admin/settings/llm-providers/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxOutputTokens: 4096 }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    assertMaskedApiKey(text);
    const parsed = JSON.parse(text) as { data: { maxOutputTokens: number } };
    expect(parsed.data.maxOutputTokens).toBe(4096);
  });

  it("DELETE /:id: 204 on hit", async () => {
    const { app } = makeApp();
    const id = await seedProvider(app);
    const res = await app.request(`/api/v1/admin/settings/llm-providers/${id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
  });

  it("DELETE /:id: 404 provider_not_found on miss", async () => {
    const { app } = makeApp();
    const res = await app.request(
      "/api/v1/admin/settings/llm-providers/ghost",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("provider_not_found");
  });

  it("POST /:id/sync: 200, masked provider + sync result", async () => {
    const { app, fetcher } = makeApp();
    const id = await seedProvider(app);
    fetcher.next = [
      { id: "gpt-4o", displayName: "GPT-4o" },
      { id: "gpt-5", displayName: "GPT-5" },
    ];
    const res = await app.request(
      `/api/v1/admin/settings/llm-providers/${id}/sync`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.includes(PLAINTEXT)).toBe(false);
    const parsed = JSON.parse(text) as {
      data: {
        provider: { auth: { apiKey: string } };
        result: { added: number };
      };
    };
    expect(isMidMaskSentinel(parsed.data.provider.auth.apiKey)).toBe(true);
    expect(parsed.data.result.added).toBe(1);
  });

  it("PATCH /:id/models/:modelId: 200 masked echo, flag applied", async () => {
    const { app } = makeApp();
    const id = await seedProvider(app);
    const res = await app.request(
      `/api/v1/admin/settings/llm-providers/${id}/models/gpt-4o`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledForSkillGen: true }),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    assertMaskedApiKey(text);
    const parsed = JSON.parse(text) as {
      data: { models: Array<{ id: string; enabledForSkillGen: boolean }> };
    };
    const m = parsed.data.models.find((x) => x.id === "gpt-4o")!;
    expect(m.enabledForSkillGen).toBe(true);
  });

  // The masking guard must hold for every auth kind, not just apiKey —
  // service.maskAuth runs midMaskSecret over `clientSecret` (tokenUrl)
  // and `password` (basic) too. POST a provider with each non-apiKey
  // kind and assert the same strongest masking on the round-trip body:
  // plaintext secret ABSENT, mid-mask sentinel form PRESENT.
  it("POST tokenUrl auth: 201 mid-masks clientSecret, plaintext absent", async () => {
    const { app } = makeApp();
    const clientSecret = "cs-real-plaintext-secret-67890";
    const res = await app.request("/api/v1/admin/settings/llm-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        providerBody({
          name: "tokenurl-test",
          auth: {
            kind: "tokenUrl",
            tokenUrl: "https://auth.example.com/oauth/token",
            clientId: "client-abc",
            clientSecret,
          },
        }),
      ),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text.includes(clientSecret)).toBe(false);
    const parsed = JSON.parse(text) as {
      data: {
        auth: { kind: string; clientId: string; clientSecret: string };
      };
    };
    expect(parsed.data.auth.kind).toBe("tokenUrl");
    // Non-secret fields pass through untouched.
    expect(parsed.data.auth.clientId).toBe("client-abc");
    expect(isMidMaskSentinel(parsed.data.auth.clientSecret)).toBe(true);
    expect(parsed.data.auth.clientSecret).not.toBe(clientSecret);
  });

  it("POST basic auth: 201 mid-masks password, plaintext absent", async () => {
    const { app } = makeApp();
    const password = "pw-real-plaintext-secret-13579";
    const res = await app.request("/api/v1/admin/settings/llm-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        providerBody({
          name: "basic-test",
          auth: { kind: "basic", username: "svc-user", password },
        }),
      ),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text.includes(password)).toBe(false);
    const parsed = JSON.parse(text) as {
      data: { auth: { kind: string; username: string; password: string } };
    };
    expect(parsed.data.auth.kind).toBe("basic");
    // Non-secret field passes through untouched.
    expect(parsed.data.auth.username).toBe("svc-user");
    expect(isMidMaskSentinel(parsed.data.auth.password)).toBe(true);
    expect(parsed.data.auth.password).not.toBe(password);
  });
});

describe("LlmProviders picker route /me/models", () => {
  it("valid surface: 200 with items + defaultModelId", async () => {
    const { app, svc } = makeApp("picker");
    await svc.create(
      {
        ...providerBody({ name: "p1" }),
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            enabledForPlayground: true,
            defaultForPlayground: true,
          },
        ],
      },
      { userId: "u", email: "e@x", displayName: "x" },
    );
    const res = await app.request("/api/v1/me/models?surface=playground");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        items: Array<{ modelId: string; isDefault: boolean }>;
        defaultModelId: string | null;
      };
    };
    expect(body.data.items[0]?.modelId).toBe("gpt-4o");
    expect(body.data.defaultModelId).toBe("gpt-4o");
  });

  it("invalid surface: 400 invalid_surface", async () => {
    const { app } = makeApp("picker");
    const res = await app.request("/api/v1/me/models?surface=bogus");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_surface");
  });

  it("sectionDefaultResolver wired: pin overrides per-model default", async () => {
    const { app, svc } = makeApp("picker", {
      sectionDefaultResolver: async () => "gpt-3.5",
    });
    await svc.create(
      {
        ...providerBody({ name: "p1" }),
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            enabledForPlayground: true,
            defaultForPlayground: true,
          },
          {
            id: "gpt-3.5",
            displayName: "GPT-3.5",
            enabledForPlayground: true,
          },
        ],
      },
      { userId: "u", email: "e@x", displayName: "x" },
    );
    const res = await app.request("/api/v1/me/models?surface=playground");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { defaultModelId: string } };
    expect(body.data.defaultModelId).toBe("gpt-3.5");
  });

  it("sectionDefaultResolver absent: falls back to per-model default", async () => {
    const { app, svc } = makeApp("picker");
    await svc.create(
      {
        ...providerBody({ name: "p1" }),
        models: [
          {
            id: "gpt-4o",
            displayName: "GPT-4o",
            enabledForPlayground: true,
            defaultForPlayground: true,
          },
          {
            id: "gpt-3.5",
            displayName: "GPT-3.5",
            enabledForPlayground: true,
          },
        ],
      },
      { userId: "u", email: "e@x", displayName: "x" },
    );
    const res = await app.request("/api/v1/me/models?surface=playground");
    const body = (await res.json()) as { data: { defaultModelId: string } };
    expect(body.data.defaultModelId).toBe("gpt-4o");
  });
});

describe("throwModelResolutionError (pure fn)", () => {
  it("ok resolution → throws a programmer-error guard", () => {
    const ok: ModelResolution = {
      kind: "ok",
      modelId: "m",
      displayName: "M",
      providerId: "p",
    };
    expect(() => throwModelResolutionError(ok)).toThrow(
      "throwModelResolutionError called on ok resolution",
    );
  });

  it("no-models-enabled → 503 MODEL_UNAVAILABLE (surface label)", () => {
    let err: AppError | null = null;
    try {
      throwModelResolutionError({ kind: "no-models-enabled", surface: "skillGen" });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.statusCode).toBe(503);
    expect(err?.code).toBe("MODEL_UNAVAILABLE");
    expect(err?.message).toContain("skill-generation");
  });

  it("not-enabled → 400 MODEL_NOT_ENABLED", () => {
    let err: AppError | null = null;
    try {
      throwModelResolutionError({
        kind: "not-enabled",
        surface: "playground",
        modelId: "gpt-4o",
      });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.statusCode).toBe(400);
    expect(err?.code).toBe("MODEL_NOT_ENABLED");
    expect(err?.message).toContain("gpt-4o");
    expect(err?.message).toContain("playground");
  });

  it("not-found → 400 MODEL_NOT_FOUND", () => {
    let err: AppError | null = null;
    try {
      throwModelResolutionError({
        kind: "not-found",
        surface: "playground",
        modelId: "ghost",
      });
    } catch (e) {
      err = e as AppError;
    }
    expect(err?.statusCode).toBe(400);
    expect(err?.code).toBe("MODEL_NOT_FOUND");
    expect(err?.message).toContain("ghost");
  });
});
