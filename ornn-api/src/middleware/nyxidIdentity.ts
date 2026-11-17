/**
 * Cryptographic verification for NyxID identity assertions.
 *
 * NyxID signs the short-lived assertion sent in
 * `X-NyxID-Identity-Token` with its active RSA key. The remote JWKS
 * resolver caches the key set and refreshes it when an assertion names an
 * unknown key id, which keeps normal key rotation working without trusting
 * an unverified claim.
 *
 * @module middleware/nyxidIdentity
 */

import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
  type FetchImplementation,
  type JWTPayload,
  type RemoteJWKSet,
} from "jose";

export const DEFAULT_NYXID_ISSUER = "https://nyx-api.chrono-ai.fun";
export const DEFAULT_NYXID_JWKS_URL = `${DEFAULT_NYXID_ISSUER}/.well-known/jwks.json`;
export const DEFAULT_NYXID_CLOCK_SKEW_SECONDS = 5;

/** The claims Ornn consumes after signature and registered-claim checks. */
export interface IdentityAssertionPayload {
  sub: string;
  email?: string;
  name?: string;
  roles: string[];
  groups: string[];
  permissions: string[];
  nyx_service_id?: string;
}

export interface IdentityTokenVerifier {
  verify(token: string): Promise<IdentityAssertionPayload>;
}

export interface IdentityTokenVerifierOptions {
  issuer: string;
  jwksUrl: string;
  /** Validate `aud` when NyxID has configured a service audience. */
  audience?: string;
  clockToleranceSeconds?: number;
  /** Dependency-injection hook for deterministic tests. */
  fetch?: FetchImplementation;
}

type VerifiedClaims = JWTPayload & {
  sub?: unknown;
  email?: unknown;
  name?: unknown;
  roles?: unknown;
  groups?: unknown;
  permissions?: unknown;
  nyx_service_id?: unknown;
};

function optionalString(value: unknown, claim: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`identity claim ${claim} must be a non-empty string`);
  }
  return value;
}

function stringArray(value: unknown, claim: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`identity claim ${claim} must be an array of strings`);
  }
  return [...value];
}

function normalizeClaims(claims: VerifiedClaims): IdentityAssertionPayload {
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("identity claim sub must be a non-empty string");
  }

  const email = optionalString(claims.email, "email");
  const name = optionalString(claims.name, "name");
  const serviceId = optionalString(claims.nyx_service_id, "nyx_service_id");
  const normalized: IdentityAssertionPayload = {
    sub: claims.sub,
    roles: stringArray(claims.roles, "roles"),
    groups: stringArray(claims.groups, "groups"),
    permissions: stringArray(claims.permissions, "permissions"),
  };
  if (email !== undefined) normalized.email = email;
  if (name !== undefined) normalized.name = name;
  if (serviceId !== undefined) normalized.nyx_service_id = serviceId;
  return normalized;
}

/**
 * Create a verifier with a process-lifetime remote JWKS cache.
 *
 * `jose` only permits the configured algorithms, requires `exp`/`sub`/`iss`,
 * checks `nbf` when present, and applies a bounded clock tolerance. Its
 * RemoteJWKSet refreshes after an unknown `kid`; a failed refresh rejects the
 * request instead of falling back to an unverified identity.
 */
export function createIdentityTokenVerifier(
  options: IdentityTokenVerifierOptions,
): IdentityTokenVerifier {
  const remoteJwksOptions = {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
    ...(options.fetch ? { [customFetch]: options.fetch } : {}),
  };
  const remoteJwks: RemoteJWKSet = createRemoteJWKSet(
    new URL(options.jwksUrl),
    remoteJwksOptions,
  );
  const clockToleranceSeconds = options.clockToleranceSeconds ?? DEFAULT_NYXID_CLOCK_SKEW_SECONDS;
  if (!Number.isInteger(clockToleranceSeconds) || clockToleranceSeconds < 0 || clockToleranceSeconds > 60) {
    throw new Error("NyxID clock tolerance must be an integer between 0 and 60 seconds");
  }

  return {
    async verify(token: string): Promise<IdentityAssertionPayload> {
      const protectedHeader = decodeProtectedHeader(token);
      if (protectedHeader.alg !== "RS256") {
        throw new Error("identity token algorithm is not allowed");
      }
      if (typeof protectedHeader.kid !== "string" || protectedHeader.kid.length === 0) {
        throw new Error("identity token is missing a key id");
      }

      const verifyOptions = {
        algorithms: ["RS256"],
        issuer: options.issuer,
        clockTolerance: clockToleranceSeconds,
        requiredClaims: ["exp", "iss", "sub"],
        ...(options.audience ? { audience: options.audience } : {}),
      };
      const { payload } = await jwtVerify<VerifiedClaims>(token, remoteJwks, verifyOptions);
      return normalizeClaims(payload);
    },
  };
}
