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
  errors,
  jwtVerify,
  type FetchImplementation,
  type JWTPayload,
  type RemoteJWKSet,
} from "jose";

export const DEFAULT_NYXID_ISSUER = "https://nyx-api.chrono-ai.fun";
export const DEFAULT_NYXID_JWKS_URL = `${DEFAULT_NYXID_ISSUER}/.well-known/jwks.json`;
// NyxID's live ornn-api binding has no custom identity_jwt_audience, so its
// identity assertions use this exact downstream service base_url as `aud`.
export const DEFAULT_NYXID_AUDIENCE =
  "http://ornn-api-deployment-api-svc.chronoai-platform.svc.cluster.local:3802";
export const DEFAULT_NYXID_CLOCK_SKEW_SECONDS = 5;
export const DEFAULT_NYXID_JWKS_TIMEOUT_MS = 5_000;
export const DEFAULT_NYXID_JWKS_COOLDOWN_MS = 30_000;
export const DEFAULT_NYXID_JWKS_CACHE_MAX_AGE_MS = 10 * 60_000;

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
  /** Exact audience emitted for this Ornn service by NyxID. */
  audience: string;
  clockToleranceSeconds?: number;
  /** Remote JWKS controls; defaults mirror jose's safe cache policy. */
  jwksTimeoutMs?: number;
  jwksCooldownMs?: number;
  jwksCacheMaxAgeMs?: number;
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
  const jwksTimeoutMs = options.jwksTimeoutMs ?? DEFAULT_NYXID_JWKS_TIMEOUT_MS;
  const jwksCooldownMs = options.jwksCooldownMs ?? DEFAULT_NYXID_JWKS_COOLDOWN_MS;
  const jwksCacheMaxAgeMs = options.jwksCacheMaxAgeMs ?? DEFAULT_NYXID_JWKS_CACHE_MAX_AGE_MS;
  if (!Number.isInteger(jwksTimeoutMs) || jwksTimeoutMs < 0) {
    throw new Error("NyxID JWKS timeout must be a non-negative integer");
  }
  if (!Number.isFinite(jwksCooldownMs) || jwksCooldownMs < 0) {
    throw new Error("NyxID JWKS cooldown must be a non-negative number");
  }
  if (!Number.isFinite(jwksCacheMaxAgeMs) || jwksCacheMaxAgeMs <= 0) {
    throw new Error("NyxID JWKS cache age must be a positive number");
  }

  const remoteJwksOptions = {
    timeoutDuration: jwksTimeoutMs,
    cooldownDuration: jwksCooldownMs,
    cacheMaxAge: jwksCacheMaxAgeMs,
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

  // jose deliberately suppresses unknown-kid refreshes during its cooldown
  // window. Keep that anti-stampede guarantee, but force one refresh for the
  // first unknown kid so a normal NyxID key rotation is accepted immediately.
  let lastForcedRefreshAt = Number.NEGATIVE_INFINITY;
  let forcedRefresh: Promise<void> | undefined;

  const verifyJwt = async (token: string) => {
    const verifyOptions = {
      algorithms: ["RS256"],
      issuer: options.issuer,
      audience: options.audience,
      clockTolerance: clockToleranceSeconds,
      requiredClaims: ["exp", "iss", "sub", "aud"],
    };
    return jwtVerify<VerifiedClaims>(token, remoteJwks, verifyOptions);
  };

  const refreshForUnknownKey = async (): Promise<void> => {
    if (forcedRefresh) return forcedRefresh;
    const now = Date.now();
    if (now - lastForcedRefreshAt < jwksCooldownMs) {
      throw new Error("NyxID JWKS refresh is cooling down");
    }
    lastForcedRefreshAt = now;
    forcedRefresh = remoteJwks.reload().finally(() => {
      forcedRefresh = undefined;
    });
    return forcedRefresh;
  };

  return {
    async verify(token: string): Promise<IdentityAssertionPayload> {
      const protectedHeader = decodeProtectedHeader(token);
      if (protectedHeader.alg !== "RS256") {
        throw new Error("identity token algorithm is not allowed");
      }
      if (typeof protectedHeader.kid !== "string" || protectedHeader.kid.length === 0) {
        throw new Error("identity token is missing a key id");
      }

      let verified: Awaited<ReturnType<typeof verifyJwt>>;
      try {
        verified = await verifyJwt(token);
      } catch (error) {
        if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
        await refreshForUnknownKey();
        verified = await verifyJwt(token);
      }
      const { payload } = verified;
      return normalizeClaims(payload);
    },
  };
}
