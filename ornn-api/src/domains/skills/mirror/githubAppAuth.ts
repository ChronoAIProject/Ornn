/**
 * GitHub App authentication for the mirror service.
 *
 * Two-step flow per GitHub's spec:
 *   1. Sign a short-lived (≤10 min) JWT with the App's RSA private key
 *      (algorithm RS256). Subject is the App's numeric id.
 *   2. POST that JWT to `/app/installations/<id>/access_tokens` to mint
 *      a 1-hour installation token, which is what every actual API call
 *      authenticates with.
 *
 * Installation tokens are cached in-process and refreshed ~5 minutes
 * before expiry — so a hot publish-time hook firing 3 times in 10
 * seconds doesn't mint 3 separate tokens. JWTs are minted on demand
 * (cheap, signing-only) and never cached.
 *
 * @module domains/skills/mirror/githubAppAuth
 */

import { createSign, createPrivateKey } from "node:crypto";
import { createLogger } from "../../../shared/logger";
const logger = createLogger("githubAppAuth");

export interface GitHubAppCredentials {
  appId: string;
  /** RSA private key in PEM format. */
  privateKey: string;
  installationId: string;
}

interface CachedToken {
  token: string;
  /** Wall-clock instant the token actually expires (UTC ms). */
  expiresAtMs: number;
}

/**
 * Mints + caches GitHub App installation tokens. One instance per
 * (appId, installationId) pair; the constructor is cheap so callers can
 * keep a singleton at module scope.
 */
export class GitHubAppAuth {
  private cached: CachedToken | null = null;
  /** Refresh tokens this many ms before they actually expire. */
  private static readonly REFRESH_SLACK_MS = 5 * 60_000; // 5 minutes
  /** JWTs we mint are valid for ~9 minutes (GitHub max is 10). */
  private static readonly JWT_TTL_SECONDS = 9 * 60;

  constructor(private readonly creds: GitHubAppCredentials) {}

  /**
   * Returns a fresh installation token, minting one if the cache is
   * empty or near expiry. Throws on any GitHub-side failure.
   */
  async getInstallationToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAtMs - now > GitHubAppAuth.REFRESH_SLACK_MS) {
      return this.cached.token;
    }
    const jwt = this.signAppJwt();
    const url = `https://api.github.com/app/installations/${encodeURIComponent(this.creds.installationId)}/access_tokens`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ornn-api-mirror",
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, body: body.slice(0, 500) },
        "GitHub App installation-token mint failed",
      );
      throw new Error(
        `GitHub installation token mint failed (${resp.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as { token?: string; expires_at?: string };
    if (!json.token || !json.expires_at) {
      throw new Error(
        "GitHub installation-token response missing required fields token / expires_at",
      );
    }
    const expiresAtMs = Date.parse(json.expires_at);
    if (Number.isNaN(expiresAtMs)) {
      throw new Error(`Invalid expires_at from GitHub: ${json.expires_at}`);
    }
    this.cached = { token: json.token, expiresAtMs };
    logger.info(
      { ttlSec: Math.round((expiresAtMs - now) / 1000) },
      "GitHub App installation token minted",
    );
    return json.token;
  }

  /**
   * Sign an RS256 JWT with the App's private key, valid for 9 minutes.
   * Pure compute — no network. Used as the bearer for the
   * installation-token mint call only.
   */
  private signAppJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iat: now - 30, // GitHub allows 60s clock skew; lean back 30s for safety
      exp: now + GitHubAppAuth.JWT_TTL_SECONDS,
      iss: this.creds.appId,
    };
    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    // Validate the PEM upfront so a bad secret throws a clear error
    // instead of a cryptic Node-level "DER" message at sign time.
    const key = createPrivateKey({ key: this.creds.privateKey, format: "pem" });
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const sigBuf = signer.sign(key);
    const encodedSig = b64urlBuffer(sigBuf);
    return `${signingInput}.${encodedSig}`;
  }
}

function b64url(s: string): string {
  return b64urlBuffer(Buffer.from(s, "utf-8"));
}

function b64urlBuffer(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
