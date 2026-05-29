/**
 * Route-level test: S3 — `POST /admin/settings/llm-providers` 201
 * response carries mid-masked secrets, never plaintext.
 *
 * @module domains/settings/llmProviders/routes.test
 */

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { isMidMaskSentinel } from "../../../infra/crypto";
import {
  LlmProvidersService,
  type ModelListFetcher,
} from "./service";
import type { StoredProvider } from "./repository";
import { createLlmProvidersRoutes } from "./routes";
import { buildProblemJsonBody } from "../../../shared/types/index";

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
}

class StubFetcher implements ModelListFetcher {
  async fetch() {
    return [];
  }
}

describe("LlmProviders POST", () => {
  it("S3: 201 response body carries mid-masked apiKey, not plaintext", async () => {
    const repo = new FakeRepo();
    const svc = new LlmProvidersService({
      repo: repo as unknown as import("./repository").LlmProvidersRepository,
      encryptionKey: KEY,
      modelListFetcher: new StubFetcher(),
    });
    const routes = createLlmProvidersRoutes({ llmProvidersService: svc });
    const app = new Hono();
    // Stub upstream auth context (production wires this via proxyAuthSetup).
    app.use("*", async (c, next) => {
      c.set("auth" as never, {
        userId: "u-admin",
        email: "admin@test.local",
        displayName: "Admin",
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

    const plaintext = "sk-real-plaintext-secret-12345";
    const body = {
      name: "openai-test",
      gatewayUrl: "https://api.openai.com",
      modelListUrl: "https://api.openai.com/v1/models",
      apiFormat: "chat-completion",
      auth: { kind: "apiKey", apiKey: plaintext },
      models: [{ id: "gpt-4o", displayName: "GPT-4o", enabled: true }],
      defaultModelId: "gpt-4o",
      maxOutputTokens: 8192,
      defaultTemperature: 0.7,
    };

    const res = await app.request("/api/v1/admin/settings/llm-providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text.includes(plaintext)).toBe(false);

    const parsed = JSON.parse(text) as {
      data: { auth: { kind: string; apiKey: string } };
    };
    expect(parsed.data.auth.kind).toBe("apiKey");
    expect(isMidMaskSentinel(parsed.data.auth.apiKey)).toBe(true);
    // Mid-mask format keeps first 4 + last 4 — confirm the body we sent
    // shows up in masked form (head + tail) but never as the full
    // plaintext string.
    expect(parsed.data.auth.apiKey).not.toBe(plaintext);
  });
});
