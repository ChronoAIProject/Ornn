/**
 * SSRF-preflight fetch wrapper (#811, redirect-hop hardening #832).
 *
 * The single shared primitive that re-resolves an outbound host at
 * fetch time and refuses private/loopback/link-local targets — the
 * DNS-rebind defense that complements write-time `validatePublicUrl`.
 * Every outbound client (chrono-storage, chrono-sandbox, NyxID,
 * LLM gateway, model-list) routes through this so a public host that
 * later flips its DNS to 169.254.169.254 / RFC1918 is caught before
 * the bearer/SA token is sent.
 *
 * Redirect handling (#832): the underlying `fetch` default is
 * `redirect: "follow"`, which transparently chases 3xx `Location`
 * headers to whatever host the upstream names — including
 * `http://169.254.169.254/`. That re-opens the exact rebind hole the
 * preflight closes: we validate the FIRST hop, then `fetch` follows a
 * 302 to the metadata host without any further check. We close this by
 * forcing `redirect: "manual"` and following redirects ourselves in a
 * bounded loop, re-running `assertPublicResolvedAddress` against EACH
 * hop's host before issuing its request. A redirect to a private /
 * metadata address therefore throws `SsrfRefusalError` on the hop that
 * names it, exactly like a first-hop rebind.
 *
 * Cross-host credential stripping: when a redirect crosses to a
 * different host, sensitive request headers (`authorization`, `cookie`,
 * `proxy-authorization`) are dropped before following — a 302 from a
 * legitimate gateway to a third-party host must not leak the caller's
 * bearer token. Same-host redirects keep the headers (they're staying
 * within the trust boundary the caller already authorized).
 *
 * Non-goals (deliberate):
 *   - NO RFC 7231 method downgrade on 301/302/303. The method and body
 *     are re-passed as-is on every hop. No current caller relies on a
 *     POST→GET downgrade, and re-issuing the original method is the
 *     safer default for our API-to-API traffic (a redirected POST that
 *     silently became a GET would drop the body and confuse callers).
 *   - NO timeout here (callers that need one pass their own
 *     `init.signal`); credential redaction / response parsing stay in
 *     the individual clients.
 *
 * @module infra/safeFetch
 */
import { createLogger } from "../shared/logger";
import { assertPublicResolvedAddress, isPrivateHost, SsrfRefusalError } from "./url";

const logger = createLogger("safeFetch");

/** Cap on followed redirects before we give up (a loop or a chain). */
const MAX_REDIRECTS = 5;

/**
 * Request headers stripped when a redirect crosses to a different host.
 * Lowercase — comparison is case-insensitive. These carry the caller's
 * credentials and must never follow a 3xx to an unrelated origin.
 */
const SENSITIVE_HEADERS = ["authorization", "cookie", "proxy-authorization"];

const ALLOWLIST_ENV = "ORNN_URL_ALLOWLIST_CIDR";

/**
 * True if `host` is on the operator allowlist (exact hostname match).
 * Mirrors the hostname fast-path in `assertPublicResolvedAddress` so a
 * redirect-hop literal-IP guard honours the same operator override.
 */
function isAllowlistedHost(host: string): boolean {
  const raw = process.env[ALLOWLIST_ENV] ?? "";
  const lower = host.toLowerCase();
  return raw
    .split(",")
    .map((s) => s.trim())
    .some((entry) => entry.length > 0 && entry === lower);
}

/**
 * Normalize `init.headers` (Headers | Record | [k,v][] | undefined) into
 * a plain object, delete `keys` case-insensitively, and return a new
 * `RequestInit` carrying the cleaned headers. Does not mutate the input.
 */
function stripSensitiveHeaders(init: RequestInit, keys: ReadonlyArray<string>): RequestInit {
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  const cleaned: Record<string, string> = {};
  const source = init.headers;
  if (source instanceof Headers) {
    source.forEach((value, name) => {
      if (!lowerKeys.has(name.toLowerCase())) cleaned[name] = value;
    });
  } else if (Array.isArray(source)) {
    for (const [name, value] of source) {
      if (!lowerKeys.has(name.toLowerCase())) cleaned[name] = value;
    }
  } else if (source) {
    for (const [name, value] of Object.entries(source)) {
      if (!lowerKeys.has(name.toLowerCase())) cleaned[name] = value;
    }
  }
  return { ...init, headers: cleaned };
}

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let currentUrl = url;
  // Force manual redirect handling — we re-validate each hop ourselves
  // instead of letting `fetch` chase 3xx to unvalidated hosts (#832).
  let currentInit: RequestInit = { ...init, redirect: "manual" };
  let prevHost: string | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid URL: '${currentUrl}'`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Refusing non-http(s) URL: '${currentUrl}'`);
    }

    logger.debug({ hop, host: parsed.hostname }, "safeFetch hop");

    // Redirect targets (hop > 0) never passed write-time
    // `validatePublicUrl`, so a `Location: http://169.254.169.254/`
    // would slip past `assertPublicResolvedAddress`'s literal-IP
    // fast-path (which assumes the literal was already vetted upstream).
    // Guard literal private/loopback/link-local IPs explicitly on each
    // redirect hop, honouring the operator allowlist. The first hop
    // keeps relying on the write-time guard so literal PUBLIC IPs (an
    // already-vetted upstream target) still work.
    if (hop > 0 && isPrivateHost(parsed.hostname) && !isAllowlistedHost(parsed.hostname)) {
      throw new SsrfRefusalError(parsed.hostname, parsed.hostname);
    }

    // Re-resolve and re-check EACH hop's host — first hop AND every
    // redirect target. Throws SsrfRefusalError on a private resolution;
    // we intentionally do NOT catch it so the refusal propagates to the
    // caller exactly as a first-hop rebind would.
    await assertPublicResolvedAddress(parsed.hostname);

    // A cross-host redirect must not carry the caller's credentials to a
    // host they did not authorize. `prevHost === null` is the first hop
    // (no redirect yet) — leave headers untouched there.
    if (prevHost !== null && parsed.hostname !== prevHost) {
      currentInit = stripSensitiveHeaders(currentInit, SENSITIVE_HEADERS);
    }

    const res = await fetch(currentUrl, currentInit);

    // Not a redirect (or a redirect with no Location) — this is the
    // final response.
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;

    // Drain the redirect response body so the connection can be reused
    // and we don't leak a dangling stream.
    res.body?.cancel();

    const nextUrl = new URL(loc, currentUrl).toString();
    const nextHost = new URL(nextUrl).hostname;
    if (nextHost !== parsed.hostname && !isPrivateHost(nextHost)) {
      // Cross-host follow is the only redirect class worth an info log
      // (a same-host redirect is routine). Suppress the log for a target
      // we're about to refuse on the next hop (private/metadata) so the
      // record reads "refused", not "following". NEVER log header /
      // token values — only the from/to hosts.
      logger.info({ from: parsed.hostname, to: nextHost }, "safeFetch following cross-host redirect");
    }
    prevHost = parsed.hostname;
    currentUrl = nextUrl;
  }

  logger.warn({ url, max: MAX_REDIRECTS }, "safeFetch exceeded redirect limit");
  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) for '${url}'`);
}
