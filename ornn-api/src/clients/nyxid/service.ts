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

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidServiceClient" });

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
  private readonly baseUrl: string;
  /**
   * Per-user-token cache. Keyed by the bearer token so two callers don't
   * leak each other's view. 60-second TTL — services don't change often,
   * but we don't want to hold an admin's view stale for 5 minutes when
   * they just toggled visibility.
   */
  private readonly cache = new Map<
    string,
    { services: NyxidCatalogService[]; expiresAt: number }
  >();
  private readonly cacheTtlMs = 60 * 1000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
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
      const resp = await fetch(`${this.baseUrl}/api/v1/services`, {
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
  }
}
