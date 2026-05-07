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
import type { AnalyticsEmitter, CallerType } from "../infra/analytics";
import { getRequestId } from "./requestId";

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

        config.emitter.trackApiRequest({
          userId,
          callerType,
          method: c.req.method,
          path: c.req.path,
          routePattern: extractRoutePattern(c),
          status,
          durationMs,
          sourceIp,
          requestId,
        });
      } catch {
        /* never fail the request because tracking blew up */
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
