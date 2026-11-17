/**
 * Security tests for NyxID identity assertion verification.
 *
 * The JWKS fetch is injected so these tests never depend on a live NyxID
 * deployment. They exercise the same jose verifier used by production and
 * the middleware's fail-closed behavior at the HTTP boundary.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type FetchImplementation,
} from "jose";
import {
  createIdentityTokenVerifier,
  DEFAULT_NYXID_AUDIENCE,
  DEFAULT_NYXID_ISSUER,
  DEFAULT_NYXID_JWKS_CACHE_MAX_AGE_MS,
  DEFAULT_NYXID_JWKS_COOLDOWN_MS,
  type IdentityTokenVerifier,
} from "./nyxidIdentity";
import {
  nyxidAuthMiddleware,
  proxyAuthSetup,
  type AuthVariables,
} from "./nyxidAuth";
import { AppError } from "../shared/types/index";

const ISSUER = "https://nyx.example.test";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const AUDIENCE = "https://ornn.example.test";

type JwkSet = { keys: Record<string, unknown>[] };

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function keyFixture(kid: string): Promise<{ privateKey: CryptoKey; jwk: Record<string, unknown> }> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, jwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } };
}

function jsonJwks(jwks: JwkSet, status = 200): Response {
  return new Response(JSON.stringify(jwks), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fixture(options: {
  audience?: string;
  issuer?: string;
  fetch?: FetchImplementation;
  jwksTimeoutMs?: number;
  jwksCooldownMs?: number;
  jwksCacheMaxAgeMs?: number;
} = {}): Promise<{
  verifier: IdentityTokenVerifier;
  privateKey: CryptoKey;
  jwks: JwkSet;
}> {
  const key = await keyFixture("known");
  const jwks: JwkSet = { keys: [key.jwk] };
  const fetch: FetchImplementation = options.fetch ?? (async () => jsonJwks(jwks));
  const verifier = createIdentityTokenVerifier({
    issuer: options.issuer ?? ISSUER,
    jwksUrl: JWKS_URL,
    audience: options.audience ?? AUDIENCE,
    clockToleranceSeconds: 0,
    ...(options.jwksTimeoutMs !== undefined ? { jwksTimeoutMs: options.jwksTimeoutMs } : {}),
    ...(options.jwksCooldownMs !== undefined ? { jwksCooldownMs: options.jwksCooldownMs } : {}),
    ...(options.jwksCacheMaxAgeMs !== undefined
      ? { jwksCacheMaxAgeMs: options.jwksCacheMaxAgeMs }
      : {}),
    fetch,
  });
  return { verifier, privateKey: key.privateKey, jwks };
}

async function token(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  header: { alg: "RS256"; kid: string } = { alg: "RS256", kid: "known" },
  options: {
    audience?: string | null;
    issuer?: string;
    expiresInSeconds?: number;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({
    sub: "user-1",
    email: "user@example.com",
    name: "User One",
    roles: ["ornn-user"],
    groups: [],
    permissions: ["ornn:skill:read"],
    nyx_service_id: "service-1",
    ...claims,
  })
    .setProtectedHeader(header)
    .setIssuer(options.issuer ?? ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 60));
  if (options.audience !== null) {
    jwt = jwt.setAudience(options.audience ?? AUDIENCE);
  }
  return jwt.sign(privateKey);
}

async function expectRejected(verifier: IdentityTokenVerifier, jwt: string): Promise<void> {
  await expect(verifier.verify(jwt)).rejects.toThrow();
}

describe("NyxID identity assertion verification", () => {
  test("accepts a valid RS256 token and returns verified permissions", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey);

    await expect(verifier.verify(jwt)).resolves.toMatchObject({
      sub: "user-1",
      email: "user@example.com",
      permissions: ["ornn:skill:read"],
    });
  });

  test("rejects an unsigned token", async () => {
    const { verifier } = await fixture();
    const jwt = `${encodeJson({ alg: "none", typ: "JWT" })}.${encodeJson({ sub: "admin" })}.`;

    await expectRejected(verifier, jwt);
  });

  test("rejects a token whose signed payload was forged to add admin permission", async () => {
    const { verifier, privateKey } = await fixture();
    const signed = await token(privateKey);
    const [header, payload, signature] = signed.split(".");
    const original = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    const forged = `${header}.${encodeJson({ ...original, permissions: ["ornn:admin:skill"] })}.${signature}`;

    await expectRejected(verifier, forged);
  });

  test("rejects the wrong issuer", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey, {}, { alg: "RS256", kid: "known" }, {
      issuer: "https://attacker.example.test",
    });

    await expectRejected(verifier, jwt);
  });

  test("rejects an expired token", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey, {}, { alg: "RS256", kid: "known" }, { expiresInSeconds: -1 });

    await expectRejected(verifier, jwt);
  });

  test("rejects a token that is not active yet", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey, {
      nbf: Math.floor(Date.now() / 1000) + 30,
    });

    await expectRejected(verifier, jwt);
  });

  test("rejects an unknown key id and an unsupported algorithm", async () => {
    const { verifier, privateKey } = await fixture();
    const unknownKid = await token(privateKey, {}, { alg: "RS256", kid: "unknown" });
    await expectRejected(verifier, unknownKid);

    const algNone = `${encodeJson({ alg: "HS256", kid: "known" })}.${encodeJson({ sub: "user-1" })}.forged`;
    await expectRejected(verifier, algNone);
  });

  test("rejects a wrong audience", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey, {}, { alg: "RS256", kid: "known" }, {
      audience: "https://other.example.test",
    });

    await expectRejected(verifier, jwt);
  });

  test("rejects a missing audience", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(privateKey, {}, { alg: "RS256", kid: "known" }, { audience: null });

    await expectRejected(verifier, jwt);
  });

  test("production defaults reject wrong and missing audiences", async () => {
    const { verifier, privateKey } = await fixture({
      issuer: DEFAULT_NYXID_ISSUER,
      audience: DEFAULT_NYXID_AUDIENCE,
    });
    const wrong = await token(privateKey, {}, { alg: "RS256", kid: "known" }, {
      issuer: DEFAULT_NYXID_ISSUER,
      audience: "https://other.example.test",
    });
    const missing = await token(privateKey, {}, { alg: "RS256", kid: "known" }, {
      issuer: DEFAULT_NYXID_ISSUER,
      audience: null,
    });

    await expectRejected(verifier, wrong);
    await expectRejected(verifier, missing);
  });

  test("unknown rotated kid forces a JWKS refresh and is accepted", async () => {
    const oldKey = await keyFixture("old");
    const rotatedKey = await keyFixture("rotated");
    let current: JwkSet = { keys: [oldKey.jwk] };
    let fetchCalls = 0;
    const fetch: FetchImplementation = async () => {
      fetchCalls += 1;
      return jsonJwks(current);
    };
    const verifier = createIdentityTokenVerifier({
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      audience: AUDIENCE,
      clockToleranceSeconds: 0,
      fetch,
    });

    await verifier.verify(await token(oldKey.privateKey, {}, { alg: "RS256", kid: "old" }));
    current = { keys: [rotatedKey.jwk] };
    const rotated = await token(rotatedKey.privateKey, {}, { alg: "RS256", kid: "rotated" });

    await expect(verifier.verify(rotated)).resolves.toMatchObject({ sub: "user-1" });
    expect(fetchCalls).toBe(2);
  });

  test("JWKS cache honors the 30-second unknown-key cooldown and 10-minute TTL", async () => {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
      const first = await keyFixture("first");
      const second = await keyFixture("second");
      const third = await keyFixture("third");
      let current: JwkSet = { keys: [first.jwk] };
      let fetchCalls = 0;
      const fetch: FetchImplementation = async () => {
        fetchCalls += 1;
        return jsonJwks(current);
      };
      const verifier = createIdentityTokenVerifier({
        issuer: ISSUER,
        jwksUrl: JWKS_URL,
        audience: AUDIENCE,
        clockToleranceSeconds: 0,
        fetch,
      });

      const longLived = { expiresInSeconds: 2_000_000 };
      await verifier.verify(await token(first.privateKey, {}, { alg: "RS256", kid: "first" }, longLived));
      await verifier.verify(await token(first.privateKey, {}, { alg: "RS256", kid: "first" }, longLived));
      expect(fetchCalls).toBe(1);

      current = { keys: [second.jwk] };
      await verifier.verify(await token(second.privateKey, {}, { alg: "RS256", kid: "second" }, longLived));
      expect(fetchCalls).toBe(2);

      current = { keys: [third.jwk] };
      const thirdToken = await token(third.privateKey, {}, { alg: "RS256", kid: "third" }, longLived);
      await expectRejected(verifier, thirdToken);
      expect(fetchCalls).toBe(2);

      now += DEFAULT_NYXID_JWKS_COOLDOWN_MS + 1;
      await verifier.verify(thirdToken);
      expect(fetchCalls).toBe(3);

      now += DEFAULT_NYXID_JWKS_CACHE_MAX_AGE_MS + 1;
      await verifier.verify(thirdToken);
      expect(fetchCalls).toBe(4);
    } finally {
      Date.now = originalNow;
    }
  });
});

function appWithVerifier(verifier: IdentityTokenVerifier): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError((error, c) => {
    const appError = error instanceof AppError ? error : undefined;
    const status = appError?.statusCode ?? 500;
    const code = appError?.code ?? "internal_error";
    return c.json({ code }, status as 401 | 500);
  });
  app.use("*", proxyAuthSetup({ identityVerifier: verifier }));
  app.get("/", (c) => c.json(c.get("auth") ?? null));
  app.get("/required", nyxidAuthMiddleware(), (c) => c.json(c.get("auth")));
  return app;
}

async function expectInvalidAtBoundary(verifier: IdentityTokenVerifier, jwt: string): Promise<void> {
  const response = await appWithVerifier(verifier).request("/", {
    headers: { "X-NyxID-Identity-Token": jwt },
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ code: "auth_invalid" });
}

describe("JWKS failures at the middleware boundary", () => {
  test("JWKS timeout is a sanitized 401 auth_invalid", async () => {
    const key = await keyFixture("timeout");
    const fetch: FetchImplementation = async (_url, { signal }) =>
      new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(new DOMException("request timed out", "TimeoutError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    const verifier = createIdentityTokenVerifier({
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      audience: AUDIENCE,
      clockToleranceSeconds: 0,
      jwksTimeoutMs: 1,
      fetch,
    });

    await expectInvalidAtBoundary(verifier, await token(key.privateKey, {}, { alg: "RS256", kid: "timeout" }));
  });

  test("malformed JWKS is a sanitized 401 auth_invalid", async () => {
    const key = await keyFixture("malformed");
    const fetch: FetchImplementation = async () => new Response(JSON.stringify({ keys: "invalid" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const verifier = createIdentityTokenVerifier({
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      audience: AUDIENCE,
      clockToleranceSeconds: 0,
      fetch,
    });

    await expectInvalidAtBoundary(verifier, await token(key.privateKey, {}, { alg: "RS256", kid: "malformed" }));
  });

  test("failed rotation refresh is a sanitized 401 auth_invalid", async () => {
    const oldKey = await keyFixture("old-refresh");
    const rotatedKey = await keyFixture("rotated-refresh");
    let fetchCalls = 0;
    const fetch: FetchImplementation = async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? jsonJwks({ keys: [oldKey.jwk] })
        : new Response("upstream unavailable", { status: 503 });
    };
    const verifier = createIdentityTokenVerifier({
      issuer: ISSUER,
      jwksUrl: JWKS_URL,
      audience: AUDIENCE,
      clockToleranceSeconds: 0,
      fetch,
    });

    await expectInvalidAtBoundary(
      verifier,
      await token(rotatedKey.privateKey, {}, { alg: "RS256", kid: "rotated-refresh" }),
    );
    expect(fetchCalls).toBe(2);
  });
});

function appWithVerifierAndHeaders(verifier: IdentityTokenVerifier): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError((_error, c) => c.json({ code: "auth_invalid" }, 401));
  app.use(
    "*",
    proxyAuthSetup({ identityVerifier: verifier, trustIdentityHeaders: true }),
  );
  app.get("/", (c) => c.json(c.get("auth") ?? null));
  return app;
}

describe("proxyAuthSetup trust boundary", () => {
  test("accepts a valid token and exposes its verified permissions to routes", async () => {
    const { verifier, privateKey } = await fixture();
    const app = appWithVerifier(verifier);
    const response = await app.request("/", {
      headers: { "X-NyxID-Identity-Token": await token(privateKey) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      userId: "user-1",
      permissions: ["ornn:skill:read"],
    });
  });

  test("does not authenticate from scalar identity headers by default", async () => {
    const { verifier } = await fixture();
    const app = appWithVerifier(verifier);
    const anonymous = await app.request("/");
    expect(anonymous.status).toBe(200);
    expect(await anonymous.json()).toBeNull();

    const required = await app.request("/required", {
      headers: {
        "X-NyxID-User-Id": "attacker",
        "X-NyxID-User-Email": "attacker@example.com",
      },
    });
    expect(required.status).toBe(401);
  });

  test("never downgrades an invalid identity token to scalar headers", async () => {
    const { verifier } = await fixture();
    const response = await appWithVerifierAndHeaders(verifier).request("/", {
      headers: {
        "X-NyxID-Identity-Token": "forged.token.value",
        "X-NyxID-User-Id": "attacker",
      },
    });
    expect(response.status).toBe(401);
  });
});
