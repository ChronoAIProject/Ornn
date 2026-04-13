/**
 * Authentication-related type definitions for NyxID OAuth.
 * @module types/auth
 */

/**
 * NyxID user information extracted from JWT claims.
 */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  roles: string[];
  permissions: string[];
}

/**
 * NyxID OAuth token response.
 */
export interface NyxIDTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

/**
 * API key metadata.
 */
export interface ApiKeyMeta {
  id: string;
  prefix: string;
  status?: "active" | "revoked";
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * OAuth provider type.
 */
export type OAuthProviderType = "github" | "google";

/**
 * OTP configuration constants.
 */
export const OTP_CONFIG = {
  length: 6,
  CODE_LENGTH: 6,
  expirySeconds: 300,
  COOLDOWN_SECONDS: 60,
} as const;

/**
 * JWT claims from NyxID access token.
 */
export interface NyxIDJwtClaims {
  sub: string;
  scope: string;
  roles: string[];
  permissions: string[];
  exp: number;
  iat: number;
  iss: string;
  aud: string;
}

/**
 * OIDC ID token claims from NyxID (includes user profile info).
 */
export interface NyxIDIdTokenClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}
