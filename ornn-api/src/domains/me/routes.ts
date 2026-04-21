/**
 * Caller-scoped endpoints — anything under /api/me describes the currently
 * authenticated user. Intentionally thin: Ornn is not the source of truth
 * for identity or membership. These routes just expose what NyxID told us
 * about the caller on this request.
 *
 * @module domains/me/routes
 */

import { Hono } from "hono";
import {
  type AuthVariables,
  nyxidAuthMiddleware,
  getAuth,
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import { AppError } from "../../shared/types/index";

export interface MeRoutesConfig {
  /**
   * Base URL for the NyxID API (same one `NyxidOrgsClient` uses). Used by
   * the back-fill org-name proxy so the frontend can render org
   * display_name for orgs the caller is no longer a member of — e.g. a
   * skill that was shared with "Org X" but the author since left.
   */
  nyxidBaseUrl: string;
}

export function createMeRoutes(config: MeRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const { nyxidBaseUrl } = config;
  const baseUrl = nyxidBaseUrl.replace(/\/+$/, "");
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  /**
   * GET /me/orgs — caller's NyxID org memberships.
   *
   * Returns `{ items: Array<{ userId, role, displayName }> }` — the
   * admin/member rows Ornn cares about (viewer is filtered upstream).
   * Used by the permissions panel to populate the "share with orgs"
   * checkbox list.
   *
   * Fail-soft: if NyxID is unreachable, returns `[]` rather than failing
   * the request. Matches the read-path behavior already baked into the
   * middleware's memoized getter.
   */
  app.get("/me/orgs", auth, async (c) => {
    // Touch the auth context so `getAuth` can surface a 401 with a clear
    // code before we reach the org-lookup helper.
    getAuth(c);
    const memberships = await readUserOrgMemberships(c);
    return c.json({ data: { items: memberships }, error: null });
  });

  /**
   * GET /me/orgs/:orgId — proxy a single-org lookup to NyxID.
   *
   * Used by the permissions panel to back-fill display names for orgs
   * that were saved on a skill earlier but the current caller may not
   * belong to. NyxID decides whether the caller can see the org at all
   * (404 if not — we let that through).
   *
   * Pinned to `/me/orgs/:id` (not `/orgs/:id`) so it's clearly a
   * caller-scoped lookup, not a generic "read any org" endpoint.
   */
  app.get("/me/orgs/:orgId", auth, async (c) => {
    const orgId = c.req.param("orgId");
    const authCtx = getAuth(c);
    const token = authCtx.userAccessToken;
    if (!token) {
      // No caller token forwarded by the proxy — we can't act on their
      // behalf. Return 404-shaped response so the UI can show "unknown
      // org" without special-casing another error code.
      throw AppError.notFound("ORG_NOT_FOUND", `Org '${orgId}' not found`);
    }

    const resp = await fetch(`${baseUrl}/api/v1/orgs/${encodeURIComponent(orgId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status === 404 || resp.status === 403) {
      throw AppError.notFound("ORG_NOT_FOUND", `Org '${orgId}' not found`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw AppError.internalError(
        "NYXID_ORG_LOOKUP_FAILED",
        `Upstream NyxID returned ${resp.status}: ${body.slice(0, 200)}`,
      );
    }

    const org = (await resp.json()) as {
      id?: string;
      user_id?: string;
      display_name?: string | null;
      avatar_url?: string | null;
    };
    return c.json({
      data: {
        userId: org.user_id ?? org.id ?? orgId,
        displayName: org.display_name ?? orgId,
        avatarUrl: org.avatar_url ?? null,
      },
      error: null,
    });
  });

  return app;
}
