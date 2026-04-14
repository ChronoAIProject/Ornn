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
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
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
 * NyxID proxy auth setup.
 *
 * Primary: decodes X-NyxID-Identity-Token JWT to extract userId, email,
 * roles, and permissions.
 *
 * Fallback: reads X-NyxID-* headers (for backward compatibility or when
 * identity propagation mode is "headers").
 */
export function proxyAuthSetup() {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    // Try identity token first (JWT mode or Both mode)
    const identityToken = c.req.header("X-NyxID-Identity-Token");
    if (identityToken) {
      const payload = decodeJwtPayload(identityToken);
      if (payload?.sub) {
        const auth: AuthContext = {
          userId: payload.sub,
          email: payload.email ?? "",
          roles: payload.roles ?? [],
          permissions: payload.permissions ?? [],
        };
        c.set("auth", auth);
        logger.debug({ userId: auth.userId, roles: auth.roles }, "Authenticated via identity token");
        await next();
        return;
      }
    }

    // Fallback to plain headers (Headers mode)
    const userId = c.req.header("X-NyxID-User-Id");
    if (userId) {
      const auth: AuthContext = {
        userId,
        email: c.req.header("X-NyxID-User-Email") ?? "",
        roles: [],
        permissions: [],
      };
      c.set("auth", auth);
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
