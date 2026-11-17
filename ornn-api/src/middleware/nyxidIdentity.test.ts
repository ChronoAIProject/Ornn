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
  type IdentityTokenVerifier,
} from "./nyxidIdentity";
import {
  nyxidAuthMiddleware,
  proxyAuthSetup,
  type AuthVariables,
} from "./nyxidAuth";

const ISSUER = "https://nyx.example.test";
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const AUDIENCE = "https://ornn.example.test";

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function fixture(): Promise<{
  verifier: IdentityTokenVerifier;
  privateKey: CryptoKey;
  jwks: { keys: Record<string, unknown>[] };
}> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const jwks = {
    keys: [{ ...publicJwk, kid: "known", alg: "RS256", use: "sig" }],
  };
  const fetch: FetchImplementation = async () =>
    new Response(JSON.stringify(jwks), {
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
  return { verifier, privateKey, jwks };
}

async function token(
  privateKey: CryptoKey,
  claims: Record<string, unknown> = {},
  header: { alg: "RS256"; kid: string } = { alg: "RS256", kid: "known" },
  options: { audience?: string; expiresInSeconds?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
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
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? 60))
    .sign(privateKey);
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
    const jwt = await new SignJWT({ sub: "user-1", exp: Math.floor(Date.now() / 1000) + 60 })
      .setProtectedHeader({ alg: "RS256", kid: "known" })
      .setIssuer("https://attacker.example.test")
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .sign(privateKey);

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

  test("validates the configured audience", async () => {
    const { verifier, privateKey } = await fixture();
    const jwt = await token(
      privateKey,
      {},
      { alg: "RS256", kid: "known" },
      { audience: "https://other.example.test" },
    );

    await expectRejected(verifier, jwt);
  });
});

function appWithVerifier(verifier: IdentityTokenVerifier): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError((error, c) => {
    const status = error instanceof Error && "statusCode" in error
      ? (error as Error & { statusCode: number }).statusCode
      : 500;
    return c.json({ code: error instanceof Error ? error.message : "unknown" }, status as 401 | 500);
  });
  app.use("*", proxyAuthSetup({ identityVerifier: verifier }));
  app.get("/", (c) => c.json(c.get("auth") ?? null));
  app.get("/required", nyxidAuthMiddleware(), (c) => c.json(c.get("auth")));
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
    const app = new Hono<{ Variables: AuthVariables }>();
    app.onError((_error, c) => c.json({ code: "auth_invalid" }, 401));
    app.use(
      "*",
      proxyAuthSetup({ identityVerifier: verifier, trustIdentityHeaders: true }),
    );
    app.get("/", (c) => c.json(c.get("auth") ?? null));

    const response = await app.request("/", {
      headers: {
        "X-NyxID-Identity-Token": "forged.token.value",
        "X-NyxID-User-Id": "attacker",
      },
    });
    expect(response.status).toBe(401);
  });
});
