/**
 * NyxID authentication middleware.
 *
 * All traffic flows through NyxID proxy; proxyAuthSetup() trusts X-NyxID-*
 * headers injected by the proxy.
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
// Setup middlewares — run once per request prefix to populate auth context
// ---------------------------------------------------------------------------

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
