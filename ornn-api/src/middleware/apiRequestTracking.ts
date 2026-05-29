/**
 * apiRequestTracking — emits one `api.request` PostHog event per
 * `/api/v1/*` request. Replaces the universal API audit middleware
 * (#245) and the `api_audit` Mongo collection. Issue #271.
 *
 * Captures the request metadata Ornn cares about for "who called
 * what API at what time" auditing:
 *   - userId (NyxID), null for anonymous
 *   - callerType: web / api / system (caller-shape detect)
 *   - method, path, routePattern (when available), status, durationMs
 *   - sourceIp (first hop from `X-Forwarded-For`, redacted to /24 / /48)
 *   - requestId for cross-log correlation
 *   - userAgent (capped at 500 chars) — distinguishes browser / SDK /
 *     CLI / bot. Truncate not redact: clients self-identify here.
 *   - queryParamKeys — comma-joined list of query-string KEYS only
 *     (never values). Lets you slice on "which filter is used" without
 *     leaking PII through search terms.
 *   - requestBytes / responseBytes — content-length on each side
 *     when set. SSE / chunked responses leave responseBytes undefined.
 *
 * Bodies are NOT captured — by design. PostHog event properties are
 * 32 KB capped and bodies don't belong in analytics. If you need
 * forensic body archive, that's a different problem from this one.
 *
 * Fail-isolated: a PostHog hiccup never propagates to the request
 * handler. The emitter itself swallows + logs SDK failures.
 *
 * @module middleware/apiRequestTracking
 */

import type { Context, Next, MiddlewareHandler } from "hono";
import { createLogger } from "../shared/logger";
import type { AnalyticsEmitter, CallerType } from "../infra/analytics";
import { getRequestId } from "./requestId";

const logger = createLogger("apiRequestTracking");

export interface ApiRequestTrackingConfig {
  emitter: AnalyticsEmitter;
}

/**
 * Hono middleware. Mount on `/api/v1/*` AFTER the auth-setup so
 * `c.var.auth` is populated by the time we read it.
 */
export function apiRequestTrackingMiddleware(
  config: ApiRequestTrackingConfig,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      try {
        const auth = c.get("auth") as
          | { userId?: string; userAccessToken?: string }
          | undefined;

        const userId = auth?.userId ?? null;
        const callerType = resolveCallerType(c, auth);
        const status = c.res.status;
        const durationMs = Date.now() - start;
        const sourceIp = redactIp(extractSourceIp(c));
        const requestId = getRequestId(c) ?? null;

        // exactOptionalPropertyTypes (#657): conditional spread on
        // every optional field so we never pass an explicit `undefined`
        // to a contract that wants `key?: T`.
        const routePattern = extractRoutePattern(c);
        const userAgent = capUserAgent(c.req.header("user-agent"));
        const queryParamKeys = extractQueryParamKeys(c);
        const requestBytes = parseContentLength(c.req.header("content-length"));
        const responseBytes = parseContentLength(c.res.headers.get("content-length"));
        config.emitter.trackApiRequest({
          userId,
          callerType,
          method: c.req.method,
          path: c.req.path,
          ...(routePattern !== undefined ? { routePattern } : {}),
          status,
          durationMs,
          sourceIp,
          requestId,
          ...(userAgent !== undefined ? { userAgent } : {}),
          ...(queryParamKeys !== undefined ? { queryParamKeys } : {}),
          ...(requestBytes !== undefined ? { requestBytes } : {}),
          ...(responseBytes !== undefined ? { responseBytes } : {}),
        });
      } catch (err) {
        // Never fail the request because tracking blew up (#579) — but
        // do log so a misconfigured emitter doesn't silently drop every
        // analytics event for hours.
        logger.debug({ err }, "api.request tracking emit failed");
      }
    }
  };
}

/**
 * Caller-type detect from auth shape. Mirrors the heuristic the old
 * audit middleware used:
 *   - `web`    — userId present, no forwarded user access token
 *                (browser cookie session via the proxy).
 *   - `api`    — userId present + forwarded user access token (NyxID
 *                proxy authenticated an agent / SDK call).
 *   - `system` — no userId, but the `X-Ornn-Caller: system` header
 *                marks an internal cron / job.
 *   - `web`    — fallback for anonymous web traffic (treats it as a
 *                browser session for taxonomy purposes; the userId
 *                being null disambiguates from a logged-in web user).
 */
function resolveCallerType(
  c: Context,
  auth: { userId?: string; userAccessToken?: string } | undefined,
): CallerType {
  const hint = c.req.header("x-ornn-caller")?.toLowerCase();
  if (hint === "system") return "system";
  if (hint === "playground") return "playground";
  if (auth?.userId) {
    return auth.userAccessToken ? "api" : "web";
  }
  return "web";
}

/**
 * First-hop client IP from `X-Forwarded-For`. The chrono-ai ingress
 * appends to XFF in `client, proxy1, proxy2` order, so the first
 * comma-separated token is what we want. Falls back to `X-Real-IP`,
 * then to null.
 */
function extractSourceIp(c: Context): string | null {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();
  return null;
}

/**
 * Privacy-preserving IP redaction:
 *   - IPv4 → /24 (last octet → 0)
 *   - IPv6 → /48 (last 80 bits → 0)
 *   - Anything else → returned as-is for debugging
 *
 * Geo / coarse-network attribution still works, but the trail can't
 * pin a specific household/device.
 */
function redactIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(".") && !ip.includes(":")) {
    const parts = ip.split(".");
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    while (parts.length < 8) parts.push("");
    for (let i = 3; i < 8; i++) parts[i] = "0";
    return parts.join(":");
  }
  return ip;
}

/**
 * Hono exposes `c.req.routePath` (the matched route pattern) on
 * recent versions. Fall back gracefully when not available.
 */
function extractRoutePattern(c: Context): string | undefined {
  const route = (c.req as unknown as { routePath?: string }).routePath;
  return typeof route === "string" && route.length > 0 ? route : undefined;
}

/**
 * Cap user-agent at 500 chars. Real browsers/SDKs are well under
 * this; a longer string is almost always a bot trying to overflow
 * something. Truncating preserves the prefix (which carries the
 * real client signature) and drops the trailing garbage.
 */
const USER_AGENT_MAX = 500;
function capUserAgent(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  return ua.length > USER_AGENT_MAX ? `${ua.slice(0, USER_AGENT_MAX)}…` : ua;
}

/**
 * Extract query-string KEYS only — comma-joined, sorted, no values.
 * Sort ensures the property is comparable across requests (PostHog
 * filters on equality). Cap to 20 keys so an attacker can't bloat
 * the event by spamming params.
 */
const QUERY_PARAM_KEYS_MAX = 20;
function extractQueryParamKeys(c: Context): string | undefined {
  let queries: Record<string, string>;
  try {
    queries = c.req.query() as Record<string, string>;
  } catch (err) {
    // c.req.query() throws on malformed query strings; analytics
    // shouldn't fail the request, but record it so a regression in
    // hono's parser doesn't silently drop every event.
    logger.debug({ err }, "query-string parse failed in extractQueryParamKeys");
    return undefined;
  }
  const keys = Object.keys(queries);
  if (keys.length === 0) return undefined;
  keys.sort();
  if (keys.length > QUERY_PARAM_KEYS_MAX) {
    keys.length = QUERY_PARAM_KEYS_MAX;
    keys[QUERY_PARAM_KEYS_MAX - 1] = "…";
  }
  return keys.join(",");
}

/**
 * Parse Content-Length header into a finite non-negative integer.
 * Anything else (missing, NaN, negative, oversized) returns
 * undefined — caller drops the property rather than emit garbage.
 */
function parseContentLength(value: string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n);
}
