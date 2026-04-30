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
  readUserOrgIds,
  readUserOrgMemberships,
} from "../../middleware/nyxidAuth";
import type { NyxidServiceClient } from "../../clients/nyxid/service";
import type { SkillRepository } from "../skills/crud/repository";
import type { ActivityRepository } from "../admin/activityRepository";
import { AppError } from "../../shared/types/index";

export interface MeRoutesConfig {
  /**
   * Base URL for the NyxID API (same one `NyxidOrgsClient` uses). Used by
   * the back-fill org-name proxy so the frontend can render org
   * display_name for orgs the caller is no longer a member of — e.g. a
   * skill that was shared with "Org X" but the author since left.
   */
  nyxidBaseUrl: string;
  skillRepo: SkillRepository;
  activityRepo: ActivityRepository;
  /**
   * Catalog-service client. Powers `GET /me/nyxid-services`, which lists
   * the NyxID services the caller can tie a skill to (public admin
   * services + private services they own).
   */
  nyxidServiceClient: NyxidServiceClient;
  /**
   * Synthetic NyxID service names appended to the bottom of every
   * `GET /me/nyxid-services` response. Driven by the
   * `EXTRA_NYXID_SERVICES` env var so operators can surface a
   * platform-side option (e.g. "NyxID") that isn't (yet) registered in
   * the catalogue. See `infra/config.ts`.
   */
  extraNyxidServices: readonly string[];
}

export function createMeRoutes(config: MeRoutesConfig): Hono<{ Variables: AuthVariables }> {
  const {
    nyxidBaseUrl,
    skillRepo,
    activityRepo,
    nyxidServiceClient,
    extraNyxidServices,
  } = config;
  const baseUrl = nyxidBaseUrl.replace(/\/+$/, "");
  const app = new Hono<{ Variables: AuthVariables }>();
  const auth = nyxidAuthMiddleware();

  /**
   * Pre-compute the synthetic-service rows once. Each entry inherits a
   * stable id of the form `synthetic:<slug>` so downstream code can
   * detect them without a round-trip to NyxID; tier is hard-pinned to
   * `admin` since these stand in for platform-side services.
   */
  const syntheticNyxidServices = extraNyxidServices.map((name) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return {
      id: `synthetic:${slug}` as const,
      slug,
      label: name,
      description: "",
      tier: "admin" as const,
    };
  });

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
  /**
   * GET /me — caller identity snapshot derived from the NyxID proxy's
   * identity token. Exists so the web client can recover from a
   * malformed OAuth id_token (some admin-created NyxID users don't
   * get `name`/`email` into the id_token but their proxy-forwarded
   * identity token is complete). Frontend calls this after OAuth
   * callback to back-fill the auth store.
   */
  app.get("/me", auth, async (c) => {
    const authCtx = getAuth(c);
    return c.json({
      data: {
        userId: authCtx.userId,
        email: authCtx.email,
        displayName: authCtx.displayName,
        roles: authCtx.roles,
        permissions: authCtx.permissions,
      },
      error: null,
    });
  });

  /**
   * POST /activity/login — caller records a session-opened event.
   * POST /activity/logout — caller records a session-closed event.
   *
   * Client-reported telemetry: the frontend fires these fire-and-forget
   * after OAuth callback success and before sign-out. Identity fields
   * are pulled from the decoded NyxID identity token (never from
   * client-supplied headers, which the proxy strips).
   *
   * Kept under `/activity/*` for v0 back-compat — Epic 2 promotes these
   * to `POST /v1/me/events` with a `{ type: "login" | "logout" }` body.
   * Moved from the `admin` domain in the Epic 1 reorg; "any authed user"
   * was never an admin operation.
   */
  app.post("/activity/login", auth, async (c) => {
    const authCtx = getAuth(c);
    await activityRepo.log(authCtx.userId, authCtx.email, authCtx.displayName, "login");
    return c.json({ data: { success: true }, error: null });
  });

  app.post("/activity/logout", auth, async (c) => {
    const authCtx = getAuth(c);
    await activityRepo.log(authCtx.userId, authCtx.email, authCtx.displayName, "logout");
    return c.json({ data: { success: true }, error: null });
  });

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

  /**
   * GET /me/nyxid-services — NyxID catalog services the caller can tie a
   * skill to.
   *
   * Returns the union of:
   *   - **admin** services (NyxID `visibility: "public"`) — visible to
   *     everyone. Tying a skill to an admin service marks the skill as a
   *     **system skill** and forces it public.
   *   - **personal** services (NyxID `visibility: "private"` AND
   *     `created_by === caller`) — services the caller created. Tying a
   *     skill to a personal service does not change the skill's privacy.
   *
   * Each item carries a `tier` field so the frontend can label / sort
   * the picker without re-deriving from the raw fields.
   *
   * Fail-soft: empty list on auth/upstream failure.
   */
  app.get("/me/nyxid-services", auth, async (c) => {
    const authCtx = getAuth(c);
    const token = authCtx.userAccessToken;
    // Even when the proxy stripped the user's token, still surface the
    // synthetic services — they don't depend on NyxID at all.
    if (!token) {
      return c.json({ data: { items: [...syntheticNyxidServices] }, error: null });
    }
    const services = await nyxidServiceClient.listServicesForCaller(token);
    const items = services
      // NyxID's filter already restricts to public + own-private, but
      // belt-and-braces: drop anything that wouldn't be eligible to tie.
      .filter((s) =>
        s.visibility === "public" ||
        (s.visibility === "private" && s.createdBy === authCtx.userId),
      )
      .map((s) => ({
        id: s.id,
        slug: s.slug,
        label: s.label,
        description: s.description,
        tier:
          s.visibility === "public"
            ? ("admin" as const)
            : ("personal" as const),
      }));

    // Append synthetic / platform-side services at the bottom so they
    // sit visually after every catalogue entry in the picker UI.
    items.push(...syntheticNyxidServices);
    return c.json({ data: { items }, error: null });
  });

  /**
   * GET /me/skills/grants-summary — aggregate the caller's own skills
   * into two buckets of grantees (orgs + users) with per-bucket skill
   * counts. Powers the registry My-Skills filter chip row: "I've
   * shared N skills with Shining Test Org 1".
   *
   * Display names are resolved best-effort on the server — orgs via
   * NyxID `/orgs/:id`, users via Ornn's activity directory. Failures
   * fall back to the raw id so the UI never renders nothing.
   */
  app.get("/me/skills/grants-summary", auth, async (c) => {
    const authCtx = getAuth(c);
    const userId = authCtx.userId;
    const raw = await skillRepo.aggregateGrantsByOwner(userId);
    const [orgs, users] = await Promise.all([
      resolveOrgDisplayNames(raw.orgs, authCtx.userAccessToken, baseUrl),
      resolveUserDisplayNames(raw.users, activityRepo),
    ]);
    return c.json({ data: { orgs, users }, error: null });
  });

  /**
   * GET /me/shared-skills/sources-summary — mirror aggregation for the
   * Shared-with-me tab. `orgs` are bridge memberships (orgs I'm in
   * where someone granted a private skill); `users` are authors who
   * shared with me directly.
   */
  app.get("/me/shared-skills/sources-summary", auth, async (c) => {
    const authCtx = getAuth(c);
    const userId = authCtx.userId;
    const userOrgIds = await readUserOrgIds(c);
    const raw = await skillRepo.aggregateSourcesForReader(userId, userOrgIds);
    const [orgs, users] = await Promise.all([
      resolveOrgDisplayNames(raw.orgs, authCtx.userAccessToken, baseUrl),
      resolveUserDisplayNames(raw.users, activityRepo),
    ]);
    return c.json({ data: { orgs, users }, error: null });
  });

  return app;
}

/**
 * Best-effort name resolution for a list of org ids. Calls NyxID
 * `GET /orgs/:id` per unique id in parallel; failures are swallowed and
 * the id is returned as its own display name so the chip row never
 * renders blank.
 */
async function resolveOrgDisplayNames(
  raw: Array<{ id: string; skillCount: number }>,
  token: string | undefined,
  baseUrl: string,
): Promise<Array<{ id: string; displayName: string; skillCount: number }>> {
  if (!token || raw.length === 0) {
    return raw.map((r) => ({ id: r.id, displayName: r.id, skillCount: r.skillCount }));
  }
  const results = await Promise.all(
    raw.map(async (r) => {
      try {
        const resp = await fetch(`${baseUrl}/api/v1/orgs/${encodeURIComponent(r.id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) return { ...r, displayName: r.id };
        const body = (await resp.json()) as { display_name?: string | null };
        return { ...r, displayName: body.display_name ?? r.id };
      } catch {
        return { ...r, displayName: r.id };
      }
    }),
  );
  return results;
}

/**
 * Best-effort name resolution for a list of user ids. Hits the
 * activity collection once per unique id through the existing email
 * directory. A user who never signed into Ornn returns as their raw
 * id — which the UI chip displays verbatim.
 */
async function resolveUserDisplayNames(
  raw: Array<{ userId: string; skillCount: number }>,
  activityRepo: ActivityRepository,
): Promise<Array<{ userId: string; email: string; displayName: string; skillCount: number }>> {
  const ids = raw.map((r) => r.userId);
  const directory = await activityRepo.findByUserIds(ids);
  const map = new Map(directory.map((d) => [d.userId, d]));
  return raw.map((r) => {
    const d = map.get(r.userId);
    return {
      userId: r.userId,
      email: d?.email ?? "",
      displayName: d?.displayName ?? d?.email ?? r.userId,
      skillCount: r.skillCount,
    };
  });
}
