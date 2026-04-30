/**
 * Integration-test harness.
 *
 * Boots the real `bootstrap()` wiring against an in-memory Mongo
 * (`mongodb-memory-server`) so every test exercises the actual routing,
 * middleware, and database layer end-to-end. External services
 * (NyxID, chrono-storage, chrono-sandbox) are configured with unreachable
 * URLs — tests pick endpoints that don't hit those services, or mock the
 * specific client when they must.
 *
 * Tests use Hono's in-process `app.request()` dispatcher, so no port is
 * bound and no network is required.
 *
 * @module tests/integration/harness
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { bootstrap } from "../../src/bootstrap";
import type { SkillConfig } from "../../src/infra/config";
import type { Hono } from "hono";

export interface Harness {
  /** The live Hono app, ready for `app.request(path, init)`. */
  readonly app: Hono;
  /** Direct database handle for seed / assertion access. */
  readonly db: Db;
  /** Mongo connection string for external tooling (rare). */
  readonly mongoUri: string;
  /** Tear down shutdown + stop the memory server. Idempotent. */
  readonly cleanup: () => Promise<void>;
}

/**
 * Identity headers stamped by the NyxID proxy. Tests simulate an
 * authenticated caller by setting these directly on the request.
 *
 * Matches `ornn-api/src/middleware/proxyAuth.ts` — which reads the
 * upstream-injected headers and populates `c.var.auth`.
 */
export interface SimAuth {
  userId: string;
  email: string;
  displayName?: string;
  permissions?: readonly string[];
}

export function authHeaders(auth: SimAuth): Record<string, string> {
  const identity = {
    sub: auth.userId,
    email: auth.email,
    name: auth.displayName ?? auth.email,
    permissions: auth.permissions ?? [],
  };
  // Base64url encode a fake JWT payload — real signature verification is
  // delegated to NyxID upstream so the middleware only decodes.
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  const token = `${header}.${payload}.`;
  return {
    "x-nyxid-identity-token": token,
    "x-nyxid-user-id": auth.userId,
    "x-nyxid-user-email": auth.email,
  };
}

let cached: Harness | null = null;

/**
 * Spin up the harness (or return the cached instance).
 *
 * Caching across tests keeps the suite fast — starting the memory-server
 * Mongo takes ~2s each time, so sharing one instance per `bun test` run
 * is worth the isolation trade-off. Individual tests MUST clean up any
 * state they seed via the `db` handle.
 */
export async function startHarness(): Promise<Harness> {
  if (cached) return cached;

  const mongo = await MongoMemoryServer.create();
  const mongoUri = mongo.getUri();

  const config: SkillConfig = {
    port: 0,
    logLevel: "error",
    logPretty: false,
    nyxidTokenUrl: "http://test.invalid/oauth/token",
    nyxidBaseUrl: "http://test.invalid",
    nyxidClientId: "test-client",
    nyxidClientSecret: "test-secret",
    nyxLlmGatewayUrl: "http://test.invalid/llm",
    mongodbUri: mongoUri,
    mongodbDb: "ornn-test",
    storageServiceUrl: "http://test.invalid/storage",
    storageBucket: "ornn-test",
    sandboxServiceUrl: "http://test.invalid/sandbox",
    defaultLlmModel: "test-model",
    llmMaxOutputTokens: 1000,
    llmTemperature: 0.5,
    sseKeepAliveIntervalMs: 15_000,
    maxPackageSizeBytes: 10 * 1024 * 1024,
    allowedOrigins: [],
    extraNyxidServices: [],
  };

  const { app, shutdown } = await bootstrap(config);

  // Separate client for test-side seeding. Bootstrap holds its own
  // internal client; closing ours does not affect it.
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(config.mongodbDb);

  const harness: Harness = {
    app,
    db,
    mongoUri,
    cleanup: async () => {
      await client.close().catch(() => {});
      await shutdown().catch(() => {});
      await mongo.stop().catch(() => {});
      cached = null;
    },
  };

  cached = harness;
  return harness;
}
