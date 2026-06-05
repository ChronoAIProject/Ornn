/**
 * Tests for GitHubAppAuth (#872).
 *
 * Exercises the two-step GitHub App auth flow without touching the
 * network: `fetch` is swapped for an in-test stub that records the
 * outbound request and returns a per-test scripted Response. The RSA
 * private key is generated fresh at runtime (PKCS#8 PEM) so no key
 * literal is ever committed and `createSign` runs against a real key.
 *
 * Coverage:
 *   - installation-token caching (1 mint shared across calls)
 *   - re-mint when the cached token is inside REFRESH_SLACK_MS of expiry
 *   - error surfaces: non-ok mint, missing token, missing/NaN expires_at
 *   - JWT shape: 3 dot-segments, RS256 header, iss=appId, ~9-min window
 *   - base64url segments contain no `+` / `/` / `=`
 *   - garbage private key throws at sign time
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { GitHubAppAuth } from "./githubAppAuth";

const APP_ID = "123456";
const INSTALLATION_ID = "7890";

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

const originalFetch = globalThis.fetch;
let captured: CapturedRequest[];
let fetchHandler: () => Promise<Response> | Response;

beforeEach(() => {
  captured = [];
  fetchHandler = () => new Response("no handler", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    captured.push({ url, init });
    return fetchHandler();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makePkcs8Pem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function tokenResponse(token: string, expiresAt: string): Response {
  return new Response(JSON.stringify({ token, expires_at: expiresAt }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** ISO timestamp `seconds` from now (negative = in the past). */
function isoFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function makeAuth(privateKey = makePkcs8Pem()): GitHubAppAuth {
  return new GitHubAppAuth({
    appId: APP_ID,
    privateKey,
    installationId: INSTALLATION_ID,
  });
}

function b64urlDecode(seg: string): string {
  return Buffer.from(seg, "base64url").toString("utf-8");
}

describe("GitHubAppAuth.getInstallationToken — caching", () => {
  it("mints once and serves the cache on a second call within the slack window", async () => {
    // expires_at one hour out → comfortably outside the 5-min refresh slack.
    fetchHandler = () => tokenResponse("ghs_token_1", isoFromNow(3600));
    const auth = makeAuth();

    const first = await auth.getInstallationToken();
    const second = await auth.getInstallationToken();

    expect(first).toBe("ghs_token_1");
    expect(second).toBe("ghs_token_1");
    expect(captured.length).toBe(1);
  });

  it("re-mints when the cached token is inside REFRESH_SLACK_MS (5 min) of expiry", async () => {
    // First mint expires in ~4 minutes — inside the 5-min refresh slack, so
    // the second call must re-mint rather than serve the stale cache.
    let call = 0;
    fetchHandler = () => {
      call += 1;
      return call === 1
        ? tokenResponse("ghs_near_expiry", isoFromNow(4 * 60))
        : tokenResponse("ghs_fresh", isoFromNow(3600));
    };
    const auth = makeAuth();

    const first = await auth.getInstallationToken();
    const second = await auth.getInstallationToken();

    expect(first).toBe("ghs_near_expiry");
    expect(second).toBe("ghs_fresh");
    expect(captured.length).toBe(2);
  });
});

describe("GitHubAppAuth.getInstallationToken — error surfaces", () => {
  it("throws with the status code when the mint call is non-ok", async () => {
    fetchHandler = () =>
      new Response("forbidden", { status: 403, headers: {} });
    const auth = makeAuth();
    await expect(auth.getInstallationToken()).rejects.toThrow(/403/);
  });

  it("throws when the response is missing the token field", async () => {
    fetchHandler = () =>
      new Response(JSON.stringify({ expires_at: isoFromNow(3600) }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const auth = makeAuth();
    await expect(auth.getInstallationToken()).rejects.toThrow(
      /missing required fields/,
    );
  });

  it("throws when the response is missing expires_at", async () => {
    fetchHandler = () =>
      new Response(JSON.stringify({ token: "ghs_x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const auth = makeAuth();
    await expect(auth.getInstallationToken()).rejects.toThrow(
      /missing required fields/,
    );
  });

  it("throws when expires_at is not a parseable date (NaN)", async () => {
    fetchHandler = () =>
      new Response(JSON.stringify({ token: "ghs_x", expires_at: "not-a-date" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const auth = makeAuth();
    await expect(auth.getInstallationToken()).rejects.toThrow(/Invalid expires_at/);
  });

  it("throws at sign time when the private key is garbage", async () => {
    // Should fail before any fetch happens.
    fetchHandler = () => tokenResponse("ghs_unreached", isoFromNow(3600));
    const auth = makeAuth("-----BEGIN PRIVATE KEY-----\nnot a real key\n-----END PRIVATE KEY-----");
    await expect(auth.getInstallationToken()).rejects.toThrow();
    expect(captured.length).toBe(0);
  });
});

describe("GitHubAppAuth — signed JWT shape", () => {
  it("sends a 3-segment RS256 JWT with iss=appId and a ~9-minute window", async () => {
    fetchHandler = () => tokenResponse("ghs_token", isoFromNow(3600));
    const auth = makeAuth();
    await auth.getInstallationToken();

    expect(captured.length).toBe(1);
    const authHeader = (captured[0]!.init?.headers as Record<string, string>)
      .Authorization!;
    expect(authHeader.startsWith("Bearer ")).toBe(true);
    const jwt = authHeader.slice("Bearer ".length);

    const segments = jwt.split(".");
    expect(segments.length).toBe(3);

    const header = JSON.parse(b64urlDecode(segments[0]!)) as {
      alg: string;
      typ: string;
    };
    expect(header.alg).toBe("RS256");
    expect(header.typ).toBe("JWT");

    const payload = JSON.parse(b64urlDecode(segments[1]!)) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(payload.iss).toBe(APP_ID);
    // iat leans back 30s, exp is +9min → the window from iat to exp is
    // ~9min30s. Assert it lands in a tolerant 9–10 minute band.
    const windowSec = payload.exp - payload.iat;
    expect(windowSec).toBeGreaterThanOrEqual(9 * 60);
    expect(windowSec).toBeLessThanOrEqual(10 * 60);
  });

  it("emits base64url segments with no +, / or = characters", async () => {
    fetchHandler = () => tokenResponse("ghs_token", isoFromNow(3600));
    const auth = makeAuth();
    await auth.getInstallationToken();

    const authHeader = (captured[0]!.init?.headers as Record<string, string>)
      .Authorization!;
    const jwt = authHeader.slice("Bearer ".length);
    for (const seg of jwt.split(".")) {
      expect(seg.includes("+")).toBe(false);
      expect(seg.includes("/")).toBe(false);
      expect(seg.includes("=")).toBe(false);
    }
  });
});
