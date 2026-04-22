/**
 * NyxID Service Registry client.
 * Fetches registered services from NyxID for System Skills feature.
 * @module clients/nyxid/service
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidServiceClient" });

export interface NyxidService {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_url: string;
  service_type: string;
  visibility: string;
  auth_method: string;
  service_category: string;
  openapi_spec_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ServiceListResponse {
  services: NyxidService[];
}

export class NyxidServiceClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string>;
  private cache: { services: NyxidService[]; expiresAt: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(baseUrl: string, getToken: () => Promise<string>) {
    this.baseUrl = baseUrl;
    this.getToken = getToken;
  }

  /**
   * List all active services from NyxID. Results are cached for 5 minutes.
   */
  async listServices(forceRefresh = false): Promise<NyxidService[]> {
    const now = Date.now();
    if (!forceRefresh && this.cache && this.cache.expiresAt > now) {
      return this.cache.services;
    }

    const token = await this.getToken();
    const url = `${this.baseUrl}/api/v1/services`;
    logger.info({ url }, "Fetching NyxID service list");

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error({ status: resp.status, body: body.slice(0, 200) }, "Failed to fetch NyxID services");
      throw new Error(`NyxID service list failed (${resp.status}): ${body.slice(0, 200)}`);
    }

    const data = (await resp.json()) as ServiceListResponse;
    const services = data.services.filter((s) => s.is_active);

    this.cache = { services, expiresAt: now + this.cacheTtlMs };
    logger.info({ count: services.length }, "NyxID services cached");
    return services;
  }

  /**
   * Fetch the OpenAPI spec from a service's spec URL.
   */
  async fetchOpenApiSpec(specUrl: string): Promise<string> {
    logger.info({ specUrl }, "Fetching OpenAPI spec");

    const resp = await fetch(specUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch OpenAPI spec from ${specUrl}: ${resp.status}`);
    }

    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      const json = await resp.json();
      return JSON.stringify(json, null, 2);
    }
    return resp.text();
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
