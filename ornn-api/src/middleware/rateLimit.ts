/**
 * Sliding-window rate-limit middleware (#439).
 *
 * Closes a real abuse surface: `/skill-search?mode=semantic` calls a
 * paid LLM per request, `/skills` POST runs the AgentSeal scan + ZIP
 * processing, and `/skills/generate` does both. Without a rate limit,
 * a trivial loop burns LLM budget or DoS's the database via Mongo
 * aggregation; an authenticated abuser can do worse than an anonymous
 * one because the auth quota gates *monthly* spend, not *burst rate*.
 *
 * Emits RFC 9239 headers on every response (#460) — clients with
 * proper backoff (`@chronoai/ornn-sdk`'s future retry wrapper, Stripe-
 * style SDKs, etc.) read these and self-throttle. Without them,
 * clients can't tell the difference between "go slower" and "go away".
 *
 * Storage is INTENTIONALLY process-local. The bucket budget is
 * PER-POD, and this is correct ONLY while ornn-api runs single-replica
 * with no HPA — the current, asserted deployment topology
 * (`deployment/ornn-api/deployment.yaml` pins `replicas: 1`). Raising
 * `replicas > 1` or adding an HPA WITHOUT a shared-store backend first
 * (tracked in #837) is a correctness bug: per-pod buckets multiply the
 * effective limit by the replica count. The shared store is therefore a
 * hard PREREQUISITE for any horizontal scale-out, not a later
 * optimisation. The middleware behind the scenes uses a
 * `Map<key, { count, resetAt }>` with periodic-on-access cleanup so
 * idle keys don't accumulate forever.
 *
 * Mount order: must run AFTER `proxyAuthSetup` so `auth.userId` is
 * available for keying. When auth is missing (public endpoints), the
 * key falls back to a trusted-position `x-forwarded-for` token —
 * counted from the right per `ORNN_TRUSTED_PROXY_HOPS` so a client-
 * prepended leftmost token can't shard the bucket (CWE-348, #813).
 * Without a usable token, everyone shares the "anonymous" bucket — a
 * fail-safe for the rare truly-public path.
 *
 * @module middleware/rateLimit
 */

import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "../shared/types/index";
import { createLogger } from "../shared/logger";

const logger = createLogger("rateLimit");

const TRUSTED_HOPS_ENV = "ORNN_TRUSTED_PROXY_HOPS";
/**
 * Number of trusted proxies that append to X-Forwarded-For in front of
 * ornn-api, beyond the immediate connecting peer. Default 0 = key on the
 * peer-appended (rightmost) token. The real client IP sits `hops` tokens
 * from the right; counting from the right defeats client-prepended spoof
 * tokens. Operators set this to match their ingress topology (#813).
 */
function readTrustedProxyHops(): number {
  const raw = Number(process.env[TRUSTED_HOPS_ENV]);
  return Number.isInteger(raw) && raw >= 0 ? raw : 0; // default/clamp on unset/NaN/negative/non-int
}

export interface RateLimitConfig {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Max requests allowed in the window. */
  readonly max: number;
  /**
   * Override how the bucket key is derived. Default: `auth.userId` →
   * `x-forwarded-for` → `"anonymous"`.
   */
  readonly keyBy?: (c: Context) => string;
  /**
   * Human-readable name for log entries. Useful when one route has
   * multiple rate-limit middleware mounted (e.g. a per-IP burst cap
   * + a per-user daily budget).
   */
  readonly label?: string;
}

interface BucketEntry {
  count: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

/**
 * Module-level bucket store. Multiple `rateLimit()` calls share this
 * map so the cleanup pass touches every active key.
 *
 * Keys are namespaced by label so two middlewares mounted on the same
 * route don't collide (e.g. `"upload:userId"` vs `"upload-ip:ip"`).
 */
const buckets = new Map<string, BucketEntry>();

/**
 * Last time we walked the bucket map to drop expired entries. Cheap
 * O(n) sweep; bounded by request rate × cleanup interval.
 */
let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 60_000;

function cleanupExpired(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

function defaultKeyBy(c: Context): string {
  const auth = (c.get as unknown as (k: "auth") => { userId?: string } | undefined)("auth");
  if (auth?.userId) return `user:${auth.userId}`;
  // XFF arrives as `client, …prepended…, realClient, proxy1, …` (proxies
  // APPEND). Key on the trusted hop counted from the RIGHT so a client-
  // prepended leftmost token cannot shard the bucket (CWE-348, #813).
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const tokens = xff.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
    const idx = tokens.length - 1 - readTrustedProxyHops();
    // idx < 0 means the chain is shorter than the configured trusted-hop
    // count (misconfig or a request that skipped the proxy chain): we cannot
    // identify a trusted token, so bucket together rather than trust a
    // client-controlled token. CRITICAL: do NOT clamp to tokens[0] — that is
    // the spoofable leftmost token (the exact bug). Fail safe to a shared bucket.
    if (idx >= 0) {
      const ip = tokens[idx];
      if (ip) return `ip:${ip}`;
    }
  }
  return "anonymous";
}

/**
 * Test seam — clears the in-process bucket store between tests.
 * Not part of the runtime API.
 */
export function __resetRateLimitForTests(): void {
  buckets.clear();
  lastCleanup = 0;
}

/**
 * Create a Hono middleware that enforces a sliding-window rate limit
 * + emits RFC 9239 headers on every response.
 *
 * Per-request flow:
 *
 *   1. Compute `key` from the request (default: per-user else per-IP).
 *   2. Look up the bucket. If the window has expired, reset the count.
 *   3. Increment + decide allow/deny.
 *   4. Emit `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`
 *      headers regardless of outcome.
 *   5. On deny, throw `AppError(429, "rate_limited")` with `Retry-After`
 *      (the global RFC 7807 handler emits it as `application/problem+json`).
 */
export function rateLimit(config: RateLimitConfig): MiddlewareHandler {
  const { windowMs, max, keyBy = defaultKeyBy, label = "default" } = config;

  return async (c, next) => {
    const now = Date.now();
    cleanupExpired(now);

    const requestKey = keyBy(c);
    const key = `${label}:${requestKey}`;
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));

    // RFC 9239 — set BEFORE the next middleware runs so even handlers
    // that emit their own response shape carry them.
    c.header("RateLimit-Limit", String(max));
    c.header("RateLimit-Remaining", String(remaining));
    c.header("RateLimit-Reset", String(resetSeconds));

    if (entry.count > max) {
      c.header("Retry-After", String(resetSeconds));
      logger.info(
        { key: requestKey, label, count: entry.count, max, resetSeconds },
        "rate_limited",
      );
      throw new AppError(
        429,
        "rate_limited",
        `Rate limit exceeded for ${label}. Retry in ${resetSeconds}s.`,
      );
    }

    await next();
  };
}
