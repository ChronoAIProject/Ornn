/**
 * API Key Middleware - Authenticates requests using API keys.
 * Used for public API endpoints that require API key authentication.
 * @module middleware/apiKeyMiddleware
 */

import { createMiddleware } from "hono/factory";
import { AppError, type ApiKeyInfo } from "../../../shared/types/index";
import type { IAuthClient } from "../../../clients/authClient";

/**
 * Type for Hono context variables with API key auth.
 */
export type ApiKeyVariables = {
  apiKeyUser: ApiKeyInfo;
};

/**
 * Create API Key authentication middleware.
 *
 * Validates Bearer token in format: `Bearer sk_xxxxx`
 * Sets `apiKeyUser` in context with user info if valid.
 *
 * Usage:
 * ```typescript
 * const apiKeyMiddleware = createApiKeyMiddleware(apiKeyService);
 * app.use('/api/v1/*', apiKeyMiddleware);
 * ```
 *
 * @param apiKeyService - API Key service for validating keys
 * @returns Hono middleware
 */
export function createApiKeyMiddleware(apiKeyService: IAuthClient) {
  return createMiddleware<{ Variables: ApiKeyVariables }>(async (c, next) => {
    // Extract Authorization header
    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      throw AppError.unauthorized("API_001", "Missing API key");
    }

    // Validate Bearer format with sk_ prefix
    if (!authHeader.startsWith("Bearer sk_")) {
      throw AppError.unauthorized(
        "API_001",
        "Invalid API key format. Expected: Bearer sk_xxxxx",
      );
    }

    const key = authHeader.slice(7); // Remove "Bearer "

    if (!key) {
      throw AppError.unauthorized("API_001", "Missing API key");
    }

    // Validate the key
    const info = await apiKeyService.validateApiKey(key);

    if (!info) {
      throw AppError.unauthorized("API_001", "Invalid API key");
    }

    // Check if key is revoked
    if (info.status === "revoked") {
      throw AppError.forbidden("API_002", "API key has been revoked");
    }

    // Set context
    c.set("apiKeyUser", info);

    await next();
  });
}

/**
 * Helper to get API key user info from request.
 * Throws if not authenticated with API key.
 */
export function getApiKeyUser(
  c: { get: (key: "apiKeyUser") => ApiKeyInfo | undefined },
): ApiKeyInfo {
  const info = c.get("apiKeyUser");
  if (!info) {
    throw AppError.unauthorized("API_001", "Not authenticated with API key");
  }
  return info;
}
