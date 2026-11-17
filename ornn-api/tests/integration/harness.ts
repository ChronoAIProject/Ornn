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
import type { NyxLlmClient } from "../../src/clients/nyxid/llm";
import type { Hono } from "hono";
import type {
  IdentityAssertionPayload,
  IdentityTokenVerifier,
} from "../../src/middleware/nyxidIdentity";

export interface Harness {
  /** The live Hono app, ready for `app.request(path, init)`. */
  readonly app: Hono;
  /** Direct database handle for seed / assertion access. */
  readonly db: Db;
  /** Mongo connection string for external tooling (rare). */
  readonly mongoUri: string;
  /**
   * Tear down shutdown + stop the memory server. Idempotent.
   *
   * Stops a real `mongod`. Under a loaded full-suite run that regularly
   * takes longer than bun's 5s hook default, so the `afterAll` calling
   * this MUST pass an explicit timeout (`}, 30_000)`) — otherwise the
   * hook is killed mid-teardown, the test file is reported as a failure,
   * and the orphaned process surfaces as `killed N dangling processes`
   * (#1215).
   */
  readonly cleanup: () => Promise<void>;
}

/**
 * Identity headers stamped by the NyxID proxy. Tests simulate an
 * authenticated caller by setting these directly on the request. The
 * harness injects a payload-only verifier because it does not run a NyxID
 * signer; production always uses the JWKS verifier.
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
    roles: [],
    groups: [],
    permissions: auth.permissions ?? [],
  };
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }))
    .toString("base64url");
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  const token = `${header}.${payload}.`;
  return {
    "x-nyxid-identity-token": token,
    "x-nyxid-user-id": auth.userId,
    "x-nyxid-user-email": auth.email,
    ...(auth.displayName !== undefined ? { "x-nyxid-user-name": auth.displayName } : {}),
  };
}

const testIdentityVerifier: IdentityTokenVerifier = {
  async verify(token): Promise<IdentityAssertionPayload> {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) throw new Error("invalid test identity token");
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.sub !== "string") throw new Error("invalid test subject");
    const identity: IdentityAssertionPayload = {
      sub: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((entry): entry is string => typeof entry === "string") : [],
      groups: Array.isArray(payload.groups) ? payload.groups.filter((entry): entry is string => typeof entry === "string") : [],
      permissions: Array.isArray(payload.permissions)
        ? payload.permissions.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
    if (typeof payload.email === "string") identity.email = payload.email;
    if (typeof payload.name === "string") identity.name = payload.name;
    return identity;
  },
};

/**
 * Optional per-harness dependency overrides. Mirrors `BootstrapOverrides`
 * — the only knob today is swapping the shared `NyxLlmClient` for an
 * in-process fake (`tests/mocks/llmGateway.ts`) so charge-path tests run
 * the real route → service → quota wiring without touching the network.
 */
export interface StartHarnessOptions {
  /** Substitute the shared LLM gateway client. */
  llmClient?: NyxLlmClient;
}

let cached: Harness | null = null;

/**
 * Spin up the harness (or return the cached instance).
 *
 * Caching across tests keeps the suite fast — starting the memory-server
 * Mongo takes ~2s each time, so sharing one instance per `bun test` run
 * is worth the isolation trade-off. Individual tests MUST clean up any
 * state they seed via the `db` handle.
 *
 * When `opts.llmClient` is set the cache is SKIPPED and a fresh,
 * non-shared harness is built — an override harness wires a different LLM
 * client, so handing back the shared default-harness instance would be
 * wrong. Override harnesses are not shared; the caller owns its lifecycle
 * and MUST `cleanup()` it.
 */
export async function startHarness(
  opts?: StartHarnessOptions,
): Promise<Harness> {
  const useOverride = !!opts?.llmClient;
  if (cached && !useOverride) return cached;

  const mongo = await MongoMemoryServer.create();
  const mongoUri = mongo.getUri();

  const config: SkillConfig = {
    port: 0,
    logLevel: "error",
    logPretty: false,
    nyxidTokenUrl: "http://test.invalid/oauth/token",
    nyxidClientId: "test-client",
    nyxidClientSecret: "test-secret",
    mongodbUri: mongoUri,
    mongodbDb: "ornn-test",
    maxPackageSizeBytes: 10 * 1024 * 1024,
    // Zip-bomb caps (#632) — mirror the production defaults so the
    // ingestion-chokepoint guard behaves the same under integration.
    maxPackageUncompressedBytes: 50 * 1024 * 1024,
    maxEntryUncompressedBytes: 25 * 1024 * 1024,
    maxPackageFileCount: 1000,
    maxCompressionRatio: 100,
    allowedOrigins: [],
    ornnPublicOrigin: "http://test.invalid",
    ornnApiBaseUrl: "http://test.invalid",
    nyxidIssuer: "https://test.invalid",
    nyxidJwksUrl: "https://test.invalid/.well-known/jwks.json",
    nyxidClockSkewSeconds: 5,
    trustIdentityHeaders: false,
    encryptionKey: "test-encryption-key-32-chars-min-12345",
    posthogEnabled: false,
    posthogApiKey: null,
    posthogProjectId: null,
    posthogHost: "https://eu.i.posthog.com",
    posthogErrorSampleRate: 0,
    agentsealPython: "/opt/agentseal/bin/python",
    agentsealScript: "/opt/agentseal/scan_skill.py",
    // #442: integration tests don't exercise AgentSeal, and the
    // configured paths don't exist on test machines. Disable the
    // scanner so the new boot-time path validator doesn't fail.
    agentsealEnabled: false,
  };

  const { app, shutdown } = await bootstrap(
    config,
    // exactOptionalPropertyTypes (#657): only attach the key when set.
    opts?.llmClient
      ? { llmClient: opts.llmClient, identityVerifier: testIdentityVerifier }
      : { identityVerifier: testIdentityVerifier },
  );

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
      // Only the shared default harness lives in `cached`; an override
      // harness was never stored there, so don't clobber the shared one.
      if (!useOverride) cached = null;
    },
  };

  if (!useOverride) cached = harness;
  return harness;
}
