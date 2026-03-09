/**
 * NyxID authentication middleware.
 * Verifies JWT access tokens using NyxID JWKS (RSA256).
 * Supports API Key auth via NyxID introspection.
 * @module middleware/nyxidAuth
 */

import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";
import type { Context, Next } from "hono";
import pino from "pino";

const logger = pino({ level: "info" }).child({ module: "nyxidAuth" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NyxIDTokenClaims {
  sub: string;
  scope?: string;
  roles: string[];
  permissions: string[];
  groups: string[];
  token_type?: string;
  exp: number;
  iat: number;
  jti: string;
  iss: string;
  aud: string;
  delegated?: boolean;
  sa?: boolean;
  act?: { sub: string };
}

export interface AuthContext {
  userId: string;
  roles: string[];
  permissions: string[];
}

export type AuthVariables = {
  auth: AuthContext;
  userToken: string;
};

// ---------------------------------------------------------------------------
// AppError (inlined from ornn-shared to avoid circular dependency)
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
// JWKS Cache
// ---------------------------------------------------------------------------

let jwksInstance: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (!jwksInstance) {
    jwksInstance = createRemoteJWKSet(new URL(jwksUrl));
    logger.info({ jwksUrl }, "Initialized JWKS remote key set");
  }
  return jwksInstance;
}

// ---------------------------------------------------------------------------
// NyxID Introspection (for API Keys)
// ---------------------------------------------------------------------------

interface IntrospectionResult {
  active: boolean;
  sub?: string;
  roles?: string[];
  permissions?: string[];
  groups?: string[];
  scope?: string;
}

async function introspectApiKey(
  apiKey: string,
  introspectionUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<IntrospectionResult> {
  const response = await fetch(introspectionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      token: apiKey,
      token_type_hint: "api_key",
    }),
  });

  if (!response.ok) {
    logger.error({ status: response.status }, "NyxID introspection request failed");
    throw new AppError(503, "NYXID_INTROSPECTION_FAILED", "Failed to introspect API key");
  }

  return response.json() as Promise<IntrospectionResult>;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractToken(c: Context): { token: string; isApiKey: boolean } | null {
  const authHeader = c.req.header("Authorization");
  const apiKeyHeader = c.req.header("X-API-Key");

  if (apiKeyHeader && apiKeyHeader.startsWith("nyx_")) {
    return { token: apiKeyHeader, isApiKey: true };
  }

  if (authHeader) {
    if (!authHeader.startsWith("Bearer ")) {
      throw new AppError(401, "AUTH_INVALID_FORMAT", "Invalid authorization header format");
    }
    const token = authHeader.slice(7);
    if (!token) {
      throw new AppError(401, "AUTH_MISSING_TOKEN", "Missing token");
    }
    const isApiKey = token.startsWith("nyx_");
    return { token, isApiKey };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Middleware Factories
// ---------------------------------------------------------------------------

export interface NyxIDAuthConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
  introspectionUrl: string;
  clientId: string;
  clientSecret: string;
}

/**
 * NyxID auth middleware. Verifies JWT using JWKS or API Key via introspection.
 * Sets auth context and raw user token on success.
 */
export function nyxidAuthMiddleware(config: NyxIDAuthConfig) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const extracted = extractToken(c);
    if (!extracted) {
      throw new AppError(401, "AUTH_MISSING", "Missing authorization");
    }

    const { token, isApiKey } = extracted;

    if (isApiKey) {
      const result = await introspectApiKey(
        token,
        config.introspectionUrl,
        config.clientId,
        config.clientSecret,
      );

      if (!result.active) {
        throw new AppError(401, "AUTH_INVALID_KEY", "Invalid or expired API key");
      }

      c.set("auth", {
        userId: result.sub ?? "",
        roles: result.roles ?? [],
        permissions: result.permissions ?? [],
      });
      c.set("userToken", token);
    } else {
      const jwks = getJWKS(config.jwksUrl);

      let verified: JWTVerifyResult;
      try {
        verified = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Token verification failed";
        logger.debug({ err: message }, "JWT verification failed");
        throw new AppError(401, "AUTH_INVALID_TOKEN", "Invalid or expired token");
      }

      const claims = verified.payload as unknown as NyxIDTokenClaims;

      c.set("auth", {
        userId: claims.sub,
        roles: claims.roles ?? [],
        permissions: claims.permissions ?? [],
      });
      c.set("userToken", token);
    }

    await next();
  });
}

/**
 * Permission check middleware. Requires the user to have ALL specified permissions.
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
 * Resource ownership check middleware.
 * Allows access if the user owns the resource or has ornn:admin:skill permission.
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

/**
 * Helper to get the raw user token from request.
 */
export function getUserToken(c: Context<{ Variables: AuthVariables }>): string {
  const token = c.get("userToken");
  if (!token) {
    throw new AppError(401, "AUTH_MISSING", "Not authenticated");
  }
  return token;
}
