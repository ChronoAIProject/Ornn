/**
 * IT-LLM-SYNC-IDEMPOTENT, IT-LLM-SYNC-NEW-MODEL, IT-LLM-SYNC-REMOVED-MODEL.
 *
 * Drives `LlmProvidersService.sync()` against a real `mongodb-memory-server`
 * Mongo + a controllable Bun HTTP mock for the upstream model-list
 * endpoint. The fetcher is a thin wrapper that hits `modelListUrl` and
 * decodes the OpenAI-shaped `{ data: [{ id }] }` response.
 *
 * @module tests/integration/llmProviders_sync.test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { LlmProvidersRepository } from "../../src/domains/settings/llmProviders/repository";
import {
  LlmProvidersService,
  type ModelListFetcher,
} from "../../src/domains/settings/llmProviders/service";
import type { LlmProviderAuth } from "../../src/domains/settings/llmProviders/types";
import { startModelListServer, type ModelListMock } from "../mocks/modelListServer";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";
const ACTOR = { userId: "u-admin", email: "admin@test.local", displayName: "Admin" };

const baseInput = {
  name: "openai",
  gatewayUrl: "https://api.openai.com",
  apiFormat: "chat-completion" as const,
  maxOutputTokens: 8192,
  defaultTemperature: 0.7,
  models: [
    { id: "gpt-4o", displayName: "GPT-4o", enabledForPlayground: true, enabledForSkillGen: true },
    { id: "gpt-3.5", displayName: "GPT-3.5" },
  ],
  auth: { kind: "apiKey" as const, apiKey: "sk-test" },
};

class HttpFetcher implements ModelListFetcher {
  async fetch(args: {
    modelListUrl: string;
    auth: LlmProviderAuth;
  }): Promise<ReadonlyArray<{ id: string; displayName: string }>> {
    const headers: Record<string, string> = {};
    if (args.auth.kind === "apiKey" && args.auth.apiKey) {
      headers.authorization = `Bearer ${args.auth.apiKey}`;
    }
    const res = await fetch(args.modelListUrl, { headers });
    if (!res.ok) {
      throw new Error(`upstream ${res.status}`);
    }
    const body = (await res.json()) as { data?: Array<{ id: string; name?: string }> };
    return (body.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.name ?? m.id,
    }));
  }
}

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let mock: ModelListMock;
let svc: LlmProvidersService;
const ALLOWLIST_ENV = "ORNN_URL_ALLOWLIST_CIDR";
const originalAllowlist = process.env[ALLOWLIST_ENV];

beforeAll(async () => {
  // The mock model-list server binds to localhost; opt that into the
  // SSRF allowlist so the schema accepts the URL. Test-scoped only —
  // restored in afterAll.
  process.env[ALLOWLIST_ENV] = "localhost,127.0.0.0/8";
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  await client.connect();
  db = client.db("ornn-it-llm");
  const repo = new LlmProvidersRepository(db);
  await repo.ensureIndexes();
  mock = await startModelListServer();
  svc = new LlmProvidersService({
    repo,
    encryptionKey: KEY,
    modelListFetcher: new HttpFetcher(),
  });
});

afterAll(async () => {
  if (originalAllowlist === undefined) {
    delete process.env[ALLOWLIST_ENV];
  } else {
    process.env[ALLOWLIST_ENV] = originalAllowlist;
  }
  await mock.close();
  await client.close();
  await mongo.stop();
}, 30_000);

describe("IT-LLM-SYNC", () => {
  it("IT-LLM-SYNC-IDEMPOTENT: second sync with same upstream catalog yields zero changes", async () => {
    const created = await svc.create(
      { ...baseInput, name: "idem-1", modelListUrl: mock.url },
      ACTOR,
    );
    mock.setNextResponse({
      body: { data: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-3.5", name: "GPT-3.5" }] },
    });
    await svc.sync(created._id, ACTOR);
    mock.setNextResponse({
      body: { data: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "gpt-3.5", name: "GPT-3.5" }] },
    });
    const { result } = await svc.sync(created._id, ACTOR);
    expect(result).toEqual({ added: 0, updated: 0, removed: 0 });
  });

  it("IT-LLM-SYNC-NEW-MODEL: arriving model lands disabled", async () => {
    const created = await svc.create(
      { ...baseInput, name: "new-model-1", modelListUrl: mock.url },
      ACTOR,
    );
    mock.setNextResponse({
      body: {
        data: [
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-3.5", name: "GPT-3.5" },
          { id: "gpt-5", name: "GPT-5" },
        ],
      },
    });
    const { provider, result } = await svc.sync(created._id, ACTOR);
    expect(result.added).toBe(1);
    const m = provider.models.find((x) => x.id === "gpt-5")!;
    expect(m.enabledForPlayground).toBe(false);
    expect(m.enabledForSkillGen).toBe(false);
    expect(m.defaultForPlayground).toBe(false);
    expect(m.defaultForSkillGen).toBe(false);
    expect(m.removed).toBe(false);
  });

  it("IT-LLM-SYNC-REMOVED-MODEL: dropped upstream model marked removed but kept", async () => {
    const created = await svc.create(
      { ...baseInput, name: "removed-1", modelListUrl: mock.url },
      ACTOR,
    );
    mock.setNextResponse({
      body: { data: [{ id: "gpt-4o", name: "GPT-4o" }] },
    });
    const { provider, result } = await svc.sync(created._id, ACTOR);
    expect(result.removed).toBe(1);
    const dropped = provider.models.find((x) => x.id === "gpt-3.5")!;
    expect(dropped).toBeDefined();
    expect(dropped.removed).toBe(true);
  });

  it("IT-LLM-SYNC-UPSTREAM-FAILURE: 5xx upstream surfaces a SERVICE_UNAVAILABLE error", async () => {
    const created = await svc.create(
      { ...baseInput, name: "fail-1", modelListUrl: mock.url },
      ACTOR,
    );
    mock.setNextResponse({ status: 503, body: { error: "down" } });
    let err: unknown = null;
    try {
      await svc.sync(created._id, ACTOR);
    } catch (e) {
      err = e;
    }
    expect(err).toBeTruthy();
    expect((err as { code: string }).code).toBe("MODEL_LIST_UNREACHABLE");
  });
});
