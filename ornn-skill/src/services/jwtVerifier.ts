/**
 * Local JWT access token verifier for ornn-skill.
 * Verifies JWT tokens using the shared JWT_SECRET.
 * Implements TokenVerifier from ornn-shared.
 * @module services/jwtVerifier
 */

import { sign, verify } from "hono/jwt";
import { AppError, type TokenVerifier, type AccessTokenPayload } from "ornn-shared";

/**
 * Create a local JWT verifier that can validate access tokens.
 * Uses the same JWT_SECRET shared across all services.
 */
export function createJwtVerifier(jwtSecret: string): TokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
      try {
        const payload = await verify(token, jwtSecret, "HS256") as AccessTokenPayload;
        return payload;
      } catch {
        throw AppError.unauthorized("AUTH_004", "Invalid or expired access token");
      }
    },
  };
}
