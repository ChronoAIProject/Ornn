/**
 * Shared base utilities for all NyxID-backed clients.
 *
 * Exposes:
 *   - `NyxidSaTokenProvider` — OAuth2 client-credentials token cache used
 *     for ornn → downstream service-account calls (chrono-storage,
 *     chrono-sandbox behind the NyxID proxy, Chrono LLM catalog). Not
 *     used for user-scoped calls: those ride on the caller's bearer
 *     token forwarded by the proxy.
 *   - `NyxidConfig` — runtime config shape resolved on every call from
 *     admin settings (per Architecture §7.2 the NyxID base URL + paths
 *     live in the `nyxid` settings section, not env). Each NyxID client
 *     takes a `() => Promise<NyxidConfig>` resolver so an admin's URL
 *     edit lands on the next call without a redeploy.
 *
 * @module clients/nyxid/base
 */

import { createLogger } from "../../shared/logger";
const logger = createLogger("nyxidSaTokenProvider");

/**
 * Runtime-resolvable NyxID config. Sourced from admin settings on every
 * call — the surrounding `SettingsService` caches with a short TTL so
 * the read cost is amortized.
 *
 * Both the API base URL AND the SA OAuth credentials live in the
 * `integrations/nyxid` settings section and are read on demand. There
 * are no NyxID env vars: a fresh deployment has empty admin settings
 * until an operator configures them, and SA token minting fails-fast
 * with a clear error in that window.
 */
export interface NyxidConfig {
  /** Base URL of the NyxID API (no trailing slash). */
  readonly baseApiUrl: string;
}

export type NyxidConfigResolver = () => Promise<NyxidConfig>;

export interface NyxidSaCreds {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export type NyxidSaCredsResolver = () => Promise<NyxidSaCreds>;

/**
 * Caches and refreshes an SA (service-account) access token. Tokens are
 * cached until 60s before expiry; the next call refreshes on demand.
 *
 * Credentials are pulled lazily from a resolver (typically a closure
 * over `SettingsService.getNyxid()`), so an admin's edit lands on the
 * next refresh without a redeploy. An empty/missing credential triggers
 * a structured error rather than a silent unauthenticated request.
 *
 * Concurrent callers during a refresh race will all issue their own
 * token request. Acceptable at current scale — add a `pendingRefresh`
 * promise field if token-endpoint pressure becomes an issue.
 */
export class NyxidSaTokenProvider {
  private cache: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly credsResolver: NyxidSaCredsResolver) {}

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now + 60_000) {
      return this.cache.accessToken;
    }

    const { tokenUrl, clientId, clientSecret } = await this.credsResolver();
    if (!tokenUrl || !clientId || !clientSecret) {
      throw new Error(
        "NyxID SA credentials are not configured — set tokenUrl, clientId, and clientSecret under admin Settings → Integrations → NyxID",
      );
    }

    logger.info("Acquiring SA access token for proxy-authenticated services");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    });
    const resp = await fetch(tokenUrl, {
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
