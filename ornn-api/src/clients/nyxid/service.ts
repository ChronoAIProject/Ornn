/**
 * NyxID service-registry client.
 *
 * Calls NyxID's `GET /api/v1/services` endpoint to discover the catalog
 * services the caller can see. Per the backend filter:
 *   - Admin callers → every active service.
 *   - Non-admin    → public services + private services they created.
 *
 * Used by Ornn for system-skill ties: a skill tied to a service with
 * `visibility: "public"` is a "system skill" (platform-wide); a skill
 * tied to a service with `visibility: "private"` is a "personal" tie.
 *
 * @module clients/nyxid/service
 */

import { createLogger } from "../../shared/logger";
import { safeFetch } from "../../infra/safeFetch";
import type { NyxidConfigResolver } from "./base";

const logger = createLogger("nyxidServiceClient");

/**
 * Catalog service shape Ornn cares about. Mirrors a small subset of
 * NyxID's `ServiceResponse`.
 */
export interface NyxidCatalogService {
  id: string;
  slug: string;
  /** Human-friendly name; falls back to slug client-side. */
  label: string;
  description: string | null;
  /** `"public"` (admin / platform-wide) or `"private"` (per-user). */
  visibility: "public" | "private";
  /** NyxID user id of whoever registered the service. */
  createdBy: string;
  isActive: boolean;
}

/** Raw NyxID `ServiceResponse` we project into `NyxidCatalogService`. */
interface RawCatalogService {
  id?: string;
  slug?: string;
  name?: string | null;
  description?: string | null;
  visibility?: string;
  is_active?: boolean;
  created_by?: string;
}

interface RawListResponse {
  services?: RawCatalogService[];
  items?: RawCatalogService[];
}

export class NyxidServiceClient {
  private readonly resolver: NyxidConfigResolver;
  /**
   * Per-user-token cache. Keyed by the bearer token so two callers don't
   * leak each other's view. Short TTL: when an admin deactivates a
   * service in NyxID we want Ornn surfaces to drop it promptly (#715).
   * Pre-#715 this was 60s, which left a window where Ornn still
   * advertised a service NyxID had deactivated; 10s is the new ceiling.
   */
  private readonly cache = new Map<
    string,
    { services: NyxidCatalogService[]; expiresAt: number }
  >();
  private readonly cacheTtlMs = 10 * 1000;

  /**
   * Dedicated cache for the platform-wide active-service id set
   * resolved via the SA token (`listActiveServiceIdsAsPlatform`). The
   * SA view is identical for every caller, so one cache slot is
   * enough — separate from the per-caller `cache` above to avoid
   * cross-contaminating visibility scopes.
   */
  private platformActiveCache: { ids: Set<string>; expiresAt: number } | null = null;

  constructor(opts: { resolver: NyxidConfigResolver }) {
    this.resolver = opts.resolver;
  }

  private async resolveBaseUrl(): Promise<string> {
    const cfg = await this.resolver();
    return cfg.baseApiUrl.replace(/\/+$/, "");
  }

  /**
   * List catalog services visible to the caller. Authenticated with
   * the caller's bearer token (so NyxID applies the right visibility
   * filter — public + own-private). Returns `[]` and logs on error;
   * callers fail-soft.
   */
  async listServicesForCaller(userAccessToken: string): Promise<NyxidCatalogService[]> {
    if (!userAccessToken) return [];
    const now = Date.now();
    const cached = this.cache.get(userAccessToken);
    if (cached && cached.expiresAt > now) {
      return cached.services;
    }
    try {
      const baseUrl = await this.resolveBaseUrl();
      const resp = await safeFetch(`${baseUrl}/api/v1/services`, {
        headers: { Authorization: `Bearer ${userAccessToken}` },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        logger.warn(
          { status: resp.status, body: body.slice(0, 200) },
          "NyxID /services call failed; returning empty",
        );
        return [];
      }
      const json = (await resp.json()) as RawListResponse | RawCatalogService[];
      const raw: RawCatalogService[] = Array.isArray(json)
        ? json
        : json.services ?? json.items ?? [];
      const services: NyxidCatalogService[] = [];
      for (const r of raw) {
        const id = r.id;
        const slug = r.slug;
        if (!id || !slug) continue;
        if (r.is_active === false) continue;
        const visibilityRaw = (r.visibility ?? "public").toLowerCase();
        const visibility: "public" | "private" =
          visibilityRaw === "private" ? "private" : "public";
        services.push({
          id,
          slug,
          label: r.name ?? slug,
          description: r.description ?? null,
          visibility,
          createdBy: r.created_by ?? "",
          isActive: true,
        });
      }
      this.cache.set(userAccessToken, { services, expiresAt: now + this.cacheTtlMs });
      return services;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "NyxID /services fetch threw; returning empty",
      );
      return [];
    }
  }

  /**
   * Resolve a single catalog service by id, scoped to the caller's
   * visibility. Returns `null` when the service is missing OR hidden
   * from the caller — both cases are treated identically so existence
   * is not leaked. Internally uses the cached list.
   */
  async findVisibleToCaller(
    userAccessToken: string,
    serviceId: string,
  ): Promise<NyxidCatalogService | null> {
    const services = await this.listServicesForCaller(userAccessToken);
    return services.find((s) => s.id === serviceId) ?? null;
  }

  /** Drop the per-token cache for a specific token (e.g. on logout). */
  invalidateCache(userAccessToken?: string): void {
    if (userAccessToken) this.cache.delete(userAccessToken);
    else this.cache.clear();
    this.platformActiveCache = null;
  }

  /**
   * Resolve the platform-wide set of *active* NyxID service ids using
   * an SA token (NyxID admin view → every service, before filtering).
   * Used by Ornn surfaces that need to know "is this service still
   * usable" independent of the calling user — most importantly the
   * anonymous-friendly `/skill-facets/system-services` aggregator,
   * which would otherwise advertise services NyxID has deactivated
   * (#715).
   *
   * Errors fail-soft: when NyxID is unreachable we return `null` so
   * callers can decide whether to skip the filter (preserve current
   * behaviour) or fail-closed. Cached for 10s to keep the hot path
   * cheap without prolonging the visibility lag after a deactivation.
   */
  async listActiveServiceIdsAsPlatform(saToken: string): Promise<Set<string> | null> {
    if (!saToken) return null;
    const now = Date.now();
    if (this.platformActiveCache && this.platformActiveCache.expiresAt > now) {
      return this.platformActiveCache.ids;
    }
    try {
      const baseUrl = await this.resolveBaseUrl();
      const resp = await safeFetch(`${baseUrl}/api/v1/services`, {
        headers: { Authorization: `Bearer ${saToken}` },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        logger.warn(
          { status: resp.status, body: body.slice(0, 200) },
          "NyxID /services SA fetch failed; returning null (no filter)",
        );
        return null;
      }
      const json = (await resp.json()) as RawListResponse | RawCatalogService[];
      const raw: RawCatalogService[] = Array.isArray(json)
        ? json
        : json.services ?? json.items ?? [];
      const ids = new Set<string>();
      for (const r of raw) {
        if (!r.id) continue;
        if (r.is_active === false) continue;
        ids.add(r.id);
      }
      this.platformActiveCache = { ids, expiresAt: now + this.cacheTtlMs };
      return ids;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        "NyxID /services SA fetch threw; returning null (no filter)",
      );
      return null;
    }
  }
}
