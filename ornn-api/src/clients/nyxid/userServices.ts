/**
 * NyxID per-user service client.
 *
 * Calls `GET /api/v1/user-services` on the caller's own bearer token to
 * list the NyxID services the caller can manage — both the ones owned
 * personally and any inherited via an org membership. NyxID is the
 * source of truth; Ornn stores none of it.
 *
 * Used by the System-skill filter: a user-authored skill is considered
 * "system" for the caller when any of its tags match the slug (or
 * label) of a service in this list. Service presence decides the
 * filter's scope — if the caller drops a NyxID service, the skill's
 * tag no longer matches and the skill quietly stops being flagged as
 * system (without any server-side cleanup).
 *
 * Throws on network or HTTP error. Callers are expected to fail-soft
 * on reads (treat as an empty list) — identical posture to
 * `NyxidOrgsClient`.
 *
 * @module clients/nyxid/userServices
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidUserServicesClient" });

/**
 * Minimal per-user service shape Ornn cares about. Mirrors the subset
 * of NyxID's `GET /api/v1/user-services` response needed to power the
 * System-skill filter + its chip UI.
 */
export interface UserService {
  /** NyxID user-service document id (stable across updates). */
  id: string;
  /** URL-safe slug; primary matcher against skill tags. */
  slug: string;
  /** Human label for UI chips. Falls back to slug server-side. */
  label: string;
}

/** Raw shape returned by NyxID's `GET /api/v1/user-services`. */
interface RawUserService {
  id?: string;
  slug?: string;
  label?: string | null;
  catalog_service_name?: string | null;
  catalog_service_slug?: string | null;
  is_active?: boolean;
}

interface RawResponse {
  keys?: RawUserService[];
  services?: RawUserService[];
  items?: RawUserService[];
}

export class NyxidUserServicesClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * List user-services accessible to the caller (personal + inherited
   * via org memberships). Viewer-only rows and inactive rows are dropped
   * — the System-skill filter is about "services the user actually works
   * with", not "every row NyxID could show".
   */
  async listUserServices(userAccessToken: string): Promise<UserService[]> {
    const url = `${this.baseUrl}/api/v1/user-services`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, body: body.slice(0, 200) },
        "NyxID /user-services call failed",
      );
      throw new Error(`NyxID /user-services failed (${resp.status}): ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as RawResponse | RawUserService[];
    const raw: RawUserService[] = Array.isArray(json)
      ? json
      : json.keys ?? json.services ?? json.items ?? [];

    const services: UserService[] = [];
    for (const entry of raw) {
      if (entry.is_active === false) continue;
      const id = entry.id;
      const slug = entry.slug ?? entry.catalog_service_slug ?? undefined;
      if (!id || !slug) continue;
      services.push({
        id,
        slug,
        label: entry.label ?? entry.catalog_service_name ?? slug,
      });
    }
    return services;
  }
}
