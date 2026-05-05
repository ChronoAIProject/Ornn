/**
 * Caller-type classification for audit records.
 *
 * The ground truth is the **authentication shape** — what header(s)
 * actually carried a verifiable identity. The `X-Ornn-Caller` request
 * header is a *hint*: the frontend stamps it `web` so analytics-style
 * dashboards can split human-driven traffic from agent traffic without
 * inferring it. The hint is untrusted; we record both the inferred
 * `callerType` and a `callerTypeMismatch` flag when the hint disagrees.
 *
 * Auth shape decision tree:
 *
 *   - NyxID OAuth cookie / browser-scope Bearer — the proxy attaches an
 *     `X-NyxID-Identity-Token` JWT and, separately, forwards the user's
 *     `Authorization: Bearer <access-token>` header. When the auth setup
 *     middleware has populated `auth` with `userAccessToken` set, that
 *     means a forwarded user access token is present → this is an agent
 *     calling on the user's behalf via the NyxID proxy. Without
 *     `userAccessToken` (cookie-only sessions / no Bearer) → web.
 *
 *   - No auth context at all → anonymous.
 *
 * Mismatch is informational only — never blocks the request.
 *
 * @module middleware/audit/callerType
 */

import type { CallerType } from "./types";

export interface CallerTypeAuthHint {
  /** Did the request resolve to an authenticated identity? */
  readonly hasAuth: boolean;
  /**
   * Was a user access token forwarded by the NyxID proxy alongside the
   * identity token? The proxy only does this for agent flows — browser
   * OAuth cookies do not surface a user Bearer token to ornn-api.
   *
   * When `hasAuth` is false, this MUST also be false; we never look at
   * a forwarded token without an identity to attach it to.
   */
  readonly hasForwardedUserToken: boolean;
}

export interface CallerTypeResolution {
  readonly callerType: CallerType;
  /** Raw header value. Lowercased for storage. `null` when absent. */
  readonly headerHint: string | null;
  readonly callerTypeMismatch: boolean;
}

/**
 * Classify the caller. `headerHint` is the raw `X-Ornn-Caller` header
 * value (or null). The caller passes the auth shape as a small struct
 * rather than the full Hono context — keeps this function easy to test
 * and reuse from non-middleware call sites.
 */
export function resolveCallerType(
  authHint: CallerTypeAuthHint,
  headerHint: string | null,
): CallerTypeResolution {
  const normalizedHint = headerHint?.trim().toLowerCase() || null;

  if (!authHint.hasAuth) {
    // Anonymous never mismatches — there's nothing to disagree with.
    return {
      callerType: "anonymous",
      headerHint: normalizedHint,
      callerTypeMismatch: false,
    };
  }

  if (authHint.hasForwardedUserToken) {
    // Agent via NyxID proxy. Mismatch when the header non-empty disagrees
    // — we expect agents to either not stamp the header at all, or to
    // intentionally identify themselves. A `web` stamp on an agent flow
    // is the classic "frontend bug or someone replaying a curl" signal.
    const mismatch = normalizedHint !== null && normalizedHint !== "agent";
    return {
      callerType: "agent",
      headerHint: normalizedHint,
      callerTypeMismatch: mismatch,
    };
  }

  // Browser session — identity token without forwarded user Bearer. We
  // expect `X-Ornn-Caller: web`; missing or any other value is mismatch.
  const mismatch = normalizedHint !== "web";
  return {
    callerType: "web",
    headerHint: normalizedHint,
    callerTypeMismatch: mismatch,
  };
}
