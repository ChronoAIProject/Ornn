/**
 * NyxID Organizations client.
 *
 * Fetches the set of organizations a user belongs to by calling NyxID's
 * own `GET /api/v1/orgs` endpoint, authenticated as the user. NyxID is
 * the source of truth for org + membership data — Ornn stores none of it.
 *
 * Ornn treats org viewers as non-members (they appear in NyxID's response
 * with role `"viewer"` and are stripped here before Ornn sees them).
 *
 * @module clients/nyxidOrgsClient
 */

import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidOrgsClient" });

/**
 * Membership record Ornn cares about. Mirrors the subset of NyxID's
 * `/orgs` response needed for visibility + authorization decisions.
 */
export interface OrgMembership {
  /** The org's `user_id` (NyxID models org-as-user). */
  userId: string;
  /** Display name, shown in owner-picker UIs. */
  displayName: string;
  /** `"admin"` or `"member"`. Viewer entries are filtered out upstream. */
  role: "admin" | "member";
}

/** Raw response shape from `GET /api/v1/orgs`. */
interface RawNyxidOrg {
  user_id?: string;
  id?: string;
  display_name?: string | null;
  name?: string | null;
  role?: string;
}

interface RawResponse {
  orgs?: RawNyxidOrg[];
  items?: RawNyxidOrg[];
}

export class NyxidOrgsClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  /**
   * List the orgs the caller belongs to. Authenticates with the user's own
   * access token (this is a "what am I in?" question, not a service-to-service
   * call). Viewer memberships are dropped.
   *
   * Throws on network or HTTP error — callers are expected to fail-soft
   * (treat as empty list) on read paths and fail-closed on write paths.
   */
  async listUserOrgs(userAccessToken: string): Promise<OrgMembership[]> {
    const url = `${this.baseUrl}/api/v1/orgs`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, body: body.slice(0, 200) },
        "NyxID /orgs call failed",
      );
      throw new Error(`NyxID /orgs failed (${resp.status}): ${body.slice(0, 200)}`);
    }

    const json = (await resp.json()) as RawResponse | RawNyxidOrg[];
    const raw: RawNyxidOrg[] = Array.isArray(json)
      ? json
      : json.orgs ?? json.items ?? [];

    const memberships: OrgMembership[] = [];
    for (const entry of raw) {
      const userId = entry.user_id ?? entry.id;
      const role = entry.role?.toLowerCase();
      if (!userId) continue;
      if (role !== "admin" && role !== "member") continue;
      memberships.push({
        userId,
        displayName: entry.display_name ?? entry.name ?? userId,
        role,
      });
    }
    return memberships;
  }
}
