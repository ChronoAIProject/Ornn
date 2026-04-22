/**
 * Shared base utilities for all NyxID-backed clients.
 *
 * Currently exposes `NyxidSaTokenProvider` — an OAuth2 client-credentials
 * token cache used for ornn → downstream service-account calls (e.g.
 * chrono-storage, chrono-sandbox behind the NyxID proxy). Not used for
 * user-scoped calls: those ride on the caller's bearer token forwarded
 * by the proxy.
 *
 * @module clients/nyxid/base
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidSaTokenProvider" });

/**
 * Caches and refreshes an SA (service-account) access token. Tokens are
 * cached until 60s before expiry; the next call refreshes on demand.
 *
 * Concurrent callers during a refresh race will all issue their own
 * token request. Acceptable at current scale — add a `pendingRefresh`
 * promise field if token-endpoint pressure becomes an issue.
 */
export class NyxidSaTokenProvider {
  private cache: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly tokenUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now + 60_000) {
      return this.cache.accessToken;
    }

    logger.info("Acquiring SA access token for proxy-authenticated services");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const resp = await fetch(this.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`SA token acquisition failed (${resp.status}): ${errText.slice(0, 200)}`);
    }
    const result = (await resp.json()) as { access_token: string; expires_in?: number };
    if (!result.access_token) {
      throw new Error("SA token response missing access_token");
    }
    this.cache = {
      accessToken: result.access_token,
      expiresAt: now + (result.expires_in ?? 900) * 1000,
    };
    return this.cache.accessToken;
  }
}
