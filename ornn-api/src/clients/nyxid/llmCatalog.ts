/**
 * Chrono LLM catalog client.
 *
 * Calls `https://nyx.chrono-ai.fun/api/v1/proxy/s/chrono-llm/models` — a
 * NyxID-brokered proxy to Chrono LLM's `/v1/models` endpoint. The
 * service-account access token is fetched via the shared
 * `NyxidSaTokenProvider`, so the same OAuth client_credentials flow
 * already used by `NyxLlmClient` and the storage/sandbox clients
 * authorizes the catalog read.
 *
 * Sync mode is on-demand only (admin clicks "Refresh catalog") — the
 * upstream response is small (~60 models) and admins curate the
 * enabled subset. There's no scheduled cron, so this client doesn't
 * need streaming or pagination.
 *
 * @module clients/nyxid/llmCatalog
 */

import { createLogger } from "../../shared/logger";
import { safeFetch } from "../../infra/safeFetch";
import type { NyxidConfigResolver, NyxidSaTokenProvider } from "./base";

const logger = createLogger("nyxLlmCatalogClient");

export interface UpstreamModel {
  /** Upstream `id`, e.g. `gpt-5-mini`. */
  id: string;
  /** Falls back to `id` when upstream omits the human label. */
  displayName: string;
}

interface RawModelEntry {
  id?: string;
  display_name?: string;
  object?: string;
  owned_by?: string;
}

interface RawListResponse {
  data?: RawModelEntry[];
  models?: RawModelEntry[];
  items?: RawModelEntry[];
}

export interface NyxLlmCatalogClientConfig {
  readonly resolver: NyxidConfigResolver;
  readonly saTokenProvider: NyxidSaTokenProvider;
}

export class NyxLlmCatalogClient {
  private readonly resolver: NyxidConfigResolver;
  private readonly saTokenProvider: NyxidSaTokenProvider;

  constructor(config: NyxLlmCatalogClientConfig) {
    this.resolver = config.resolver;
    this.saTokenProvider = config.saTokenProvider;
    logger.info("NyxLlmCatalogClient initialized");
  }

  private async resolveUrl(): Promise<string> {
    const cfg = await this.resolver();
    const base = cfg.baseApiUrl.replace(/\/+$/, "");
    return `${base}/api/v1/proxy/s/chrono-llm/models`;
  }

  /**
   * Fetch the Chrono LLM model catalog. Returns the projected
   * `UpstreamModel[]`.
   *
   * Throws on auth or HTTP failure — the admin "Refresh" route surfaces
   * the error so operators can see why the sync didn't apply.
   */
  async listUpstreamModels(): Promise<UpstreamModel[]> {
    const url = await this.resolveUrl();
    const token = await this.saTokenProvider.getAccessToken();
    const resp = await safeFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, url, body: body.slice(0, 200) },
        "Chrono LLM catalog fetch failed",
      );
      throw new Error(
        `Chrono LLM /models failed (${resp.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as RawListResponse | RawModelEntry[];
    const raw: RawModelEntry[] = Array.isArray(json)
      ? json
      : json.data ?? json.models ?? json.items ?? [];
    const out: UpstreamModel[] = [];
    for (const entry of raw) {
      const id = entry.id?.trim();
      if (!id) continue;
      out.push({
        id,
        displayName: entry.display_name?.trim() || id,
      });
    }
    logger.info({ total: out.length }, "Chrono LLM catalog fetched");
    return out;
  }
}
