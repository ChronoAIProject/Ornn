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
import { safeFetch } from "../../infra/safeFetch";
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
 * Concurrent callers share one mint. Invalidation fences in-flight mints
 * so a settings save cannot restore credentials from the previous config.
 */
export class NyxidSaTokenProvider {
  private cache: { accessToken: string; expiresAt: number } | null = null;
  private generation = 0;
  private pending: Promise<{ accessToken: string; expiresAt: number }> | null = null;

  constructor(
    private readonly credsResolver: NyxidSaCredsResolver,
    private readonly invalidateConfig: () => void = () => {},
  ) {}

  /** A late 401 must never evict a token minted for a newer request. */
  invalidate(rejectedToken?: string): void {
    if (rejectedToken !== undefined && this.cache?.accessToken !== rejectedToken) return;
    this.generation++;
    this.cache = null;
    this.pending = null;
    this.invalidateConfig();
    logger.info("Invalidated service-account authentication cache");
  }

  async getAccessToken(): Promise<string> {
    for (;;) {
      if (this.cache && this.cache.expiresAt > Date.now() + 60_000) {
        return this.cache.accessToken;
      }
      const generation = this.generation;
      const pending = this.pending ??= this.mint();
      try {
        const token = await pending;
        if (generation !== this.generation) continue;
        this.cache = token;
        return token.accessToken;
      } catch (err) {
        if (generation !== this.generation) continue;
        throw err;
      } finally {
        if (this.pending === pending) this.pending = null;
      }
    }
  }

  private async mint(): Promise<{ accessToken: string; expiresAt: number }> {
    const now = Date.now();

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
    const resp = await safeFetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) {
      await resp.body?.cancel();
      throw new Error(`SA token acquisition failed (${resp.status})`);
    }
    // Never echo malformed authentication responses (including JSON parser errors).
    let result: { access_token?: unknown; expires_in?: unknown } | null;
    try {
      result = await resp.json();
    } catch {
      throw new Error("Invalid SA token response");
    }
    if (!result || typeof result.access_token !== "string" || !result.access_token.trim() ||
        (result.expires_in !== undefined &&
          (typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0))) {
      throw new Error("Invalid SA token response");
    }
    return {
      accessToken: result.access_token,
      expiresAt: now + ((result.expires_in as number | undefined) ?? 900) * 1000,
    };
  }
}
