/**
 * NyxID authentication middleware.
 *
 * All traffic flows through NyxID proxy. proxyAuthSetup() decodes the
 * X-NyxID-Identity-Token JWT (signed by NyxID, already verified by proxy)
 * to extract userId, email, roles, and permissions.
 *
 * Falls back to X-NyxID-* headers if the identity token is absent.
 *
 * Route-level middlewares (nyxidAuthMiddleware / optionalAuthMiddleware) only
 * check whether auth was already set by the setup layer.
 *
 * @module middleware/nyxidAuth
 */

import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { createLogger } from "../shared/logger";
import { AppError } from "../shared/types/index";

const logger = createLogger("nyxidAuth");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthContext {
  userId: string;
  email: string;
  /**
   * Human name from the identity token's `name` claim (falls back to
   * email, then userId). Populated so the UI can render a friendly
   * label when the caller's OAuth id_token lacks the `name` claim —
   * which happens for admin-created users whose token profile isn't
   * flushed through the same path as self-registered ones.
   */
  displayName: string;
  roles: string[];
  permissions: string[];
  /**
   * The user's original Bearer access token, when the NyxID proxy forwards
   * it on the `Authorization` header. Used by `NyxidOrgsClient` to call
   * NyxID's own `/orgs` endpoint on behalf of the user. Optional — when
   * absent (e.g. header mode, or proxy strips it), callers fall back to
   * empty org list (fail-soft on reads).
   */
  userAccessToken?: string;
}

/**
 * Minimal org-membership shape Ornn cares about. NyxID's viewer role is
 * filtered out upstream, so `role` is always `admin` or `member`.
 *
 * `displayName` is kept here so UI callers (owner pickers, profile
 * dropdowns) can render a human label without a second round-trip.
 */
export interface OrgMembershipFact {
  userId: string;
  role: "admin" | "member";
  displayName: string;
}

/**
 * First-class resolved/unresolved signal for the org-membership lookup (#842).
 *
 * The plain `getUserOrgMemberships` getter fails soft to `[]` for both
 * "caller genuinely has no orgs" and "we couldn't ask NyxID" — fine for
 * read visibility (a missed share just hides a skill), dangerous for the
 * write gate (a missed lookup would look like "you're a member of nothing"
 * and reject a legitimate share with a misleading 403). This discriminated
 * union lets write paths distinguish the two:
 *
 *   - `resolved`   — NyxID answered (including a 200-empty list). The
 *                    `memberships` array is authoritative.
 *   - `unresolved` — we never got an authoritative answer: either no
 *                    forwarded token (`no_token`) or the lookup threw
 *                    (`lookup_failed`). `memberships` is always `[]` and
 *                    MUST NOT be treated as "member of nothing".
 *
 * Note: a successful lookup that returns zero orgs is `resolved`, not
 * `unresolved` — the caller really is a member of no org.
 */
export type OrgMembershipResolution =
  | { status: "resolved"; memberships: OrgMembershipFact[] }
  | { status: "unresolved"; reason: "no_token" | "lookup_failed"; memberships: [] };

export type AuthVariables = {
  auth: AuthContext;
  /**
   * Lazy getter for the caller's organization memberships (admin + member
   * roles only — viewers are filtered out). Memoized per-request.
   * Returns `[]` when the caller is anonymous, has no orgs, or NyxID is
   * unreachable.
   *
   * Call sites:
   *   - Scope-aware repository queries: `readUserOrgIds(c)` reads just the
   *     user_ids off this list.
   *   - Write gates: callers inspect `role` to distinguish admin from member
   *     of a specific org.
   */
  getUserOrgMemberships?: () => Promise<OrgMembershipFact[]>;
  /**
   * Lazy getter for the same lookup as `getUserOrgMemberships`, but carrying
   * the resolved/unresolved signal (#842). Shares the SAME memo cell and SAME
   * single NyxID round-trip as `getUserOrgMemberships` — calling either getter
   * (or both) hits NyxID at most once per request. Write gates that must not
   * mistake an unresolved lookup for "member of nothing" read this one.
   */
  getUserOrgMembershipResolution?: () => Promise<OrgMembershipResolution>;
};

// ---------------------------------------------------------------------------
// JWT decode (no verification — proxy already verified the token)
// ---------------------------------------------------------------------------

interface IdentityAssertionPayload {
  sub?: string;
  email?: string;
  name?: string;
  roles?: string[];
  groups?: string[];
  permissions?: string[];
  nyx_service_id?: string;
}

/**
 * Decode a JWT payload without signature verification.
 * Safe because NyxID proxy has already verified the token before forwarding.
 */
function decodeJwtPayload(token: string): IdentityAssertionPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Length-checked above — parts[1] is guaranteed defined. `!` is
    // safe under noUncheckedIndexedAccess (#450).
    const payload = Buffer.from(parts[1]!, "base64url").toString("utf-8");
    return JSON.parse(payload) as IdentityAssertionPayload;
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "Failed to decode identity token");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Setup middlewares — run once per request prefix to populate auth context
// ---------------------------------------------------------------------------

/**
 * Optional callback fired immediately after `c.set("auth", ...)` on
 * every request that successfully resolves an identity. Used by the
 * admin-users tracker to lazily upsert a row whenever a user
 * authenticates with the `ornn:admin:skill` permission, so admin
 * lookups (`/admin/quota/users`, etc.) can mark known admins without
 * a per-row NyxID round-trip.
 *
 * Implementations MUST return immediately (fire-and-forget). Failure
 * to track must NEVER fail the request — log and swallow.
 */
export type AuthSeenHook = (auth: AuthContext) => void;

export interface ProxyAuthSetupOptions {
  /** Fired after the auth context is set on the request. */
  onAuthSeen?: AuthSeenHook;
}

/**
 * NyxID proxy auth setup.
 *
 * Primary: decodes X-NyxID-Identity-Token JWT to extract userId, email,
 * roles, and permissions.
 *
 * Fallback: reads X-NyxID-* headers (for backward compatibility or when
 * identity propagation mode is "headers").
 *
 * If `onAuthSeen` is provided, it's invoked synchronously after the
 * auth context is set so callers can lazy-track which users have ever
 * authenticated (e.g. populating `admin_users` for the admin UI).
 * The callback must not throw.
 */
export function proxyAuthSetup(options: ProxyAuthSetupOptions = {}) {
  const { onAuthSeen } = options;
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Capture the user's original access token if the proxy forwarded it.
    // Needed later to call NyxID /orgs on the caller's behalf. Optional —
    // if the proxy strips it, org lookups fail-soft to empty array.
    const rawAuthz = c.req.header("Authorization");
    const userAccessToken =
      rawAuthz && rawAuthz.toLowerCase().startsWith("bearer ")
        ? rawAuthz.slice(7).trim() || undefined
        : undefined;

    // Try identity token first (JWT mode or Both mode)
    const identityToken = c.req.header("X-NyxID-Identity-Token");
    if (identityToken) {
      const payload = decodeJwtPayload(identityToken);
      if (payload?.sub) {
        const email = payload.email ?? "";
        // exactOptionalPropertyTypes (#657)
        const auth: AuthContext = {
          userId: payload.sub,
          email,
          displayName: payload.name ?? email ?? payload.sub,
          roles: payload.roles ?? [],
          permissions: payload.permissions ?? [],
          ...(userAccessToken !== undefined ? { userAccessToken } : {}),
        };
        c.set("auth", auth);
        try {
          onAuthSeen?.(auth);
        } catch (e) {
          logger.warn({ error: (e as Error).message }, "onAuthSeen hook threw");
        }
        logger.debug({ userId: auth.userId, roles: auth.roles }, "Authenticated via identity token");
        await next();
        return;
      }
    }

    // Fallback to plain headers (Headers mode)
    const userId = c.req.header("X-NyxID-User-Id");
    if (userId) {
      const email = c.req.header("X-NyxID-User-Email") ?? "";
      // exactOptionalPropertyTypes (#657)
      const auth: AuthContext = {
        userId,
        email,
        displayName: c.req.header("X-NyxID-User-Name") ?? email ?? userId,
        roles: [],
        permissions: [],
        ...(userAccessToken !== undefined ? { userAccessToken } : {}),
      };
      c.set("auth", auth);
      try {
        onAuthSeen?.(auth);
      } catch (e) {
        logger.warn({ error: (e as Error).message }, "onAuthSeen hook threw");
      }
      logger.debug({ userId: auth.userId }, "Authenticated via proxy headers (no RBAC data)");
    }

    await next();
  });
}

// ---------------------------------------------------------------------------
// Route-level middlewares — applied per-route to enforce auth requirements
// ---------------------------------------------------------------------------

/**
 * Required auth. Throws 401 if auth context was not set by the setup layer.
 */
export function nyxidAuthMiddleware() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const auth = c.get("auth");
    if (!auth) {
      throw new AppError(401, "auth_missing", "Authentication required");
    }
    await next();
  });
}

/**
 * Optional auth. No-op — auth context is already set by setup layer if present.
 */
export function optionalAuthMiddleware() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    await next();
  });
}

// ---------------------------------------------------------------------------
// Permission / ownership checks
// ---------------------------------------------------------------------------

/**
 * Requires the user to have ALL specified permissions.
 */
export function requirePermission(...required: string[]) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth) {
      throw new AppError(401, "auth_missing", "Not authenticated");
    }

    for (const perm of required) {
      if (!auth.permissions.includes(perm)) {
        logger.warn({ userId: auth.userId, missing: perm }, "Permission denied");
        throw new AppError(403, "forbidden", `Missing permission: ${perm}`);
      }
    }

    await next();
  };
}

/**
 * Helper to get auth context from request. Throws if not authenticated.
 */
export function getAuth(c: Context<{ Variables: AuthVariables }>): AuthContext {
  const auth = c.get("auth");
  if (!auth) {
    throw new AppError(401, "auth_missing", "Not authenticated");
  }
  return auth;
}

// ---------------------------------------------------------------------------
// Org membership lookup
// ---------------------------------------------------------------------------

/**
 * Minimal shape the org lookup depends on — extracted as an interface so
 * tests can inject a fake and we avoid a hard type dependency on the
 * client class inside the middleware module.
 */
export interface OrgMembershipSource {
  listUserOrgs(
    userAccessToken: string,
  ): Promise<Array<{ userId: string; role: string; displayName: string }>>;
}

/**
 * Build a middleware that attaches the lazy org-membership getters to the
 * request context. Two getters share ONE memo cell and ONE NyxID round-trip:
 *   - `getUserOrgMemberships` → fail-soft `OrgMembershipFact[]` (`[]` for
 *     anonymous callers, no forwarded token, or a lookup error). The legacy
 *     read API — unchanged signature, unchanged fail-soft behaviour.
 *   - `getUserOrgMembershipResolution` → the same lookup carrying the
 *     resolved/unresolved discriminant (#842) for write gates that must not
 *     mistake an unresolved lookup for "member of nothing".
 *
 * The single resolve runs at most once per request and both getters await it.
 *   - no forwarded token            → unresolved / `no_token`     / `[]`
 *   - `listUserOrgs` throws         → unresolved / `lookup_failed`/ `[]`
 *     (warn-logged, same as before)
 *   - success (incl. 200-empty)     → resolved (filtered to admin + member)
 *
 * Mount this AFTER `proxyAuthSetup()` so `auth.userAccessToken` is populated.
 */
export function nyxidOrgLookupMiddleware(orgs: OrgMembershipSource) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Single shared memo cell: the first getter to run resolves it, the
    // second reuses it — so at most one NyxID round-trip per request even
    // when both the read path and the write gate ask.
    let cache: OrgMembershipResolution | null = null;
    const resolve = async (): Promise<OrgMembershipResolution> => {
      if (cache) return cache;
      const auth = c.get("auth");
      const token = auth?.userAccessToken;
      if (!token) {
        cache = { status: "unresolved", reason: "no_token", memberships: [] };
        return cache;
      }
      try {
        const raw = await orgs.listUserOrgs(token);
        const memberships = raw
          .filter((m) => m.role === "admin" || m.role === "member")
          .map((m) => ({
            userId: m.userId,
            role: m.role as "admin" | "member",
            displayName: m.displayName,
          }));
        // Resolved even when the filtered list is empty: NyxID answered
        // authoritatively that the caller belongs to no (admin/member) org.
        cache = { status: "resolved", memberships };
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, userId: auth.userId },
          "Org lookup failed; treating user as no-org",
        );
        cache = { status: "unresolved", reason: "lookup_failed", memberships: [] };
      }
      return cache;
    };
    c.set("getUserOrgMembershipResolution", resolve);
    c.set("getUserOrgMemberships", async () => (await resolve()).memberships);
    await next();
  });
}

/**
 * Resolution convenience helper (#842). Returns the resolved/unresolved
 * signal. When the middleware wasn't mounted (tests that don't wire the
 * getter) this returns `{ status: "resolved", memberships: [] }` so unrelated
 * tests behave as a caller-with-no-orgs rather than flipping into the
 * unresolved (503) branch.
 */
export async function readUserOrgMembershipResolution(
  c: Context<{ Variables: AuthVariables }>,
): Promise<OrgMembershipResolution> {
  const getter = c.get("getUserOrgMembershipResolution");
  if (!getter) return { status: "resolved", memberships: [] };
  return getter();
}

/**
 * Memberships convenience helper — returns an empty array when the middleware
 * wasn't mounted (tests) or the caller has none. Fail-soft to `[]` in every
 * case, including an unresolved lookup: the read path stays exactly as before
 * (#842 only adds a separate resolution-aware helper for write gates).
 */
export async function readUserOrgMemberships(
  c: Context<{ Variables: AuthVariables }>,
): Promise<OrgMembershipFact[]> {
  const getter = c.get("getUserOrgMemberships");
  if (!getter) return [];
  return getter();
}

/**
 * Same, but projects down to just the org user_ids — what scope queries want.
 */
export async function readUserOrgIds(
  c: Context<{ Variables: AuthVariables }>,
): Promise<string[]> {
  const ms = await readUserOrgMemberships(c);
  return ms.map((m) => m.userId);
}
