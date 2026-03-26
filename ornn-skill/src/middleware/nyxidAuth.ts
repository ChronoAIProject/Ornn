/**
 * NyxID authentication middleware.
 *
 * Two auth strategies, selected at mount time in bootstrap.ts:
 *   - jwtAuthSetup()    → web routes: verifies Bearer JWT against NyxID JWKS
 *   - proxyAuthSetup()  → agent routes: trusts X-NyxID-* headers from NyxID proxy
 *
 * Route-level middlewares (nyxidAuthMiddleware / optionalAuthMiddleware) only
 * check whether auth was already set by the setup layer.
 *
 * @module middleware/nyxidAuth
 */

import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidAuth" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthContext {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export type AuthVariables = {
  auth: AuthContext;
};

export interface JwtAuthConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
  introspectionUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// AppError (inlined to avoid circular dependency)
// ---------------------------------------------------------------------------

class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

// ---------------------------------------------------------------------------
// Setup middlewares — run once per request prefix to populate auth context
// ---------------------------------------------------------------------------

/**
 * JWT auth setup for `/api/web` routes.
 * Verifies Bearer token against NyxID JWKS and populates auth context.
 * Skips silently when no Authorization header is present (public routes).
 * Throws 401 when a token IS present but invalid/expired.
 */
export function jwtAuthSetup(config: JwtAuthConfig) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));

  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      // No token → anonymous; route-level middleware decides if that's OK
      await next();
      return;
    }

    const token = authHeader.slice(7);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
      });

      const jwtRoles = (payload as Record<string, unknown>).roles as string[] | undefined;
      const jwtPermissions = (payload as Record<string, unknown>).permissions as string[] | undefined;

      let roles = jwtRoles ?? [];
      let permissions = jwtPermissions ?? [];

      // If JWT lacks roles/permissions, fetch them from NyxID introspection
      if ((!jwtRoles?.length || !jwtPermissions?.length) && config.introspectionUrl) {
        try {
          const body = new URLSearchParams({ token });
          if (config.clientId) body.set("client_id", config.clientId);
          if (config.clientSecret) body.set("client_secret", config.clientSecret);

          const introspectResp = await fetch(config.introspectionUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          });

          if (introspectResp.ok) {
            const introspectData = await introspectResp.json() as Record<string, unknown>;
            if (introspectData.active) {
              if (!jwtRoles?.length && Array.isArray(introspectData.roles)) {
                roles = introspectData.roles as string[];
              }
              if (!jwtPermissions?.length && Array.isArray(introspectData.permissions)) {
                permissions = introspectData.permissions as string[];
              }
              logger.debug({ userId: payload.sub }, "Enriched auth from introspection");
            }
          }
        } catch (introspectErr) {
          logger.warn({ err: introspectErr }, "Token introspection failed, using JWT claims only");
        }
      }

      const auth: AuthContext = {
        userId: payload.sub!,
        email: c.req.header("X-User-Email") ?? "",
        roles,
        permissions,
      };

      c.set("auth", auth);
      logger.debug({ userId: auth.userId, permissions: auth.permissions }, "Authenticated via JWT");
    } catch (err) {
      logger.warn({ err }, "JWT verification failed");
      throw new AppError(401, "AUTH_INVALID", "Invalid or expired access token");
    }

    await next();
  });
}

/**
 * Proxy header auth setup for `/api/agent` routes.
 * Reads identity from X-NyxID-* headers injected by NyxID proxy.
 * Skips when no identity headers are present.
 */
export function proxyAuthSetup() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const userId = c.req.header("X-NyxID-User-Id");
    if (userId) {
      const auth: AuthContext = {
        userId,
        email: c.req.header("X-NyxID-User-Email") ?? "",
        roles: (c.req.header("X-NyxID-User-Roles") ?? "").split(",").filter(Boolean),
        permissions: (c.req.header("X-NyxID-User-Permissions") ?? "").split(",").filter(Boolean),
      };
      c.set("auth", auth);
      logger.debug({ userId: auth.userId }, "Authenticated via proxy headers");
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
      throw new AppError(401, "AUTH_MISSING", "Authentication required");
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
      throw new AppError(401, "AUTH_MISSING", "Not authenticated");
    }

    for (const perm of required) {
      if (!auth.permissions.includes(perm)) {
        logger.warn({ userId: auth.userId, missing: perm }, "Permission denied");
        throw new AppError(403, "FORBIDDEN", `Missing permission: ${perm}`);
      }
    }

    await next();
  };
}

/**
 * Allows access if user owns the resource or has ornn:admin:skill permission.
 */
export function requireOwnerOrAdmin(getResourceOwnerId: (c: Context) => Promise<string>) {
  return async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    const auth = c.get("auth");
    if (!auth) {
      throw new AppError(401, "AUTH_MISSING", "Not authenticated");
    }

    const ownerId = await getResourceOwnerId(c);
    if (auth.userId !== ownerId && !auth.permissions.includes("ornn:admin:skill")) {
      throw new AppError(403, "FORBIDDEN", "You can only operate on your own resources");
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
    throw new AppError(401, "AUTH_MISSING", "Not authenticated");
  }
  return auth;
}
