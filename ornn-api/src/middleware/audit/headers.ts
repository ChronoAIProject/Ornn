/**
 * Header / IP capture for the audit middleware.
 *
 * Two responsibilities, both narrow:
 *
 *   1. Extract the source IP from upstream headers (`X-Forwarded-For`
 *      first, then `X-Real-IP`, falling back to the socket address) and
 *      truncate it before it ever leaves this function. We never store
 *      the full client IP — even in memory longer than necessary — so
 *      the truncation happens at the same call site as the read.
 *
 *   2. Pull the audit-relevant non-sensitive headers into a small
 *      JSON-safe shape. Identity-bearing headers (`authorization`,
 *      `cookie`, `set-cookie`, anything starting with `x-nyxid-`) are
 *      never returned; the only header field the audit cares about is
 *      the user agent.
 *
 * Both functions are pure / synchronous so the middleware can compose
 * them without `await`, keeping the request-path overhead trivial.
 *
 * @module middleware/audit/headers
 */

/**
 * Headers that must never appear in the audit pipeline. Lowercase for
 * canonical comparison — Hono normalizes header names to lowercase on
 * read, but defensive `toLowerCase()` keeps this function safe to call
 * with any source.
 */
const ALWAYS_STRIPPED_PREFIXES = ["x-nyxid-"] as const;
const ALWAYS_STRIPPED_EXACT = new Set(["authorization", "cookie", "set-cookie"]);

export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (ALWAYS_STRIPPED_EXACT.has(lower)) return true;
  return ALWAYS_STRIPPED_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Truncate an IP address. IPv4: zero the last octet. IPv6: keep the
 * first 48 bits (3 hextets), zero the remaining 80. Mapped IPv4-in-IPv6
 * addresses (`::ffff:a.b.c.d`) are unwrapped to plain IPv4 first so the
 * truncation looks the same regardless of how the upstream framed it.
 *
 * Returns empty string when the input is empty / not parseable. We never
 * fall back to "the original string" — better to lose attribution than
 * leak a full address through a parser bug.
 */
export function truncateIp(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // Strip surrounding `[...]` for `[::1]:port`-style entries (rare but
  // observed when a proxy forgets to split off the port).
  const hostOnly = trimmed.replace(/^\[/, "").replace(/\][:].*$/, "").replace(/\]$/, "");

  // IPv4-mapped IPv6 — unwrap.
  const mapped = hostOnly.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  const candidate = mapped ? mapped[1] : hostOnly;

  // IPv4
  const v4 = candidate.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = [v4[1], v4[2], v4[3]].map((s) => Number(s));
    if (octets.every((n) => n >= 0 && n <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
    }
    return "";
  }

  // IPv6 — accept compressed and uncompressed forms. We expand to up to
  // eight hextets, then keep the first three and zero the rest.
  if (candidate.includes(":")) {
    const expanded = expandIpv6(candidate);
    if (!expanded) return "";
    return `${expanded[0]}:${expanded[1]}:${expanded[2]}::`;
  }

  return "";
}

/**
 * Expand an IPv6 address to a fixed eight-hextet array. Returns null when
 * the input doesn't look like an IPv6 string.
 */
function expandIpv6(input: string): string[] | null {
  // Reject anything with characters outside the IPv6 alphabet.
  if (!/^[0-9a-fA-F:]+$/.test(input)) return null;
  if (!input.includes(":")) return null;
  // `::` may appear at most once.
  const doubleColonCount = (input.match(/::/g) ?? []).length;
  if (doubleColonCount > 1) return null;

  let head: string[];
  let tail: string[];
  if (input.includes("::")) {
    const [h, t] = input.split("::");
    head = h ? h.split(":") : [];
    tail = t ? t.split(":") : [];
  } else {
    head = input.split(":");
    tail = [];
  }
  const totalGiven = head.length + tail.length;
  if (totalGiven > 8) return null;
  const zeros = new Array(8 - totalGiven).fill("0");
  const all = [...head, ...zeros, ...tail];
  if (all.length !== 8) return null;
  // Lowercase for canonical form. Strip leading zeros so "0001" → "1".
  return all.map((h) => h.toLowerCase().replace(/^0+(?=.)/, "") || "0");
}

/**
 * Pull the source IP out of a header bag, trying the proxy-supplied
 * headers in priority order before falling back to the socket address.
 * The bag is whatever the middleware has cheap access to — typically
 * `c.req.header(name)` evaluated on the spot.
 */
export interface IpSource {
  readonly forwardedFor: string | null;
  readonly realIp: string | null;
  readonly remoteAddr: string | null;
}

export function resolveSourceIp(src: IpSource): string {
  // X-Forwarded-For may be a comma-separated chain; the original client
  // is the leftmost entry.
  if (src.forwardedFor) {
    const first = src.forwardedFor.split(",")[0]?.trim() ?? "";
    if (first) return truncateIp(first);
  }
  if (src.realIp) {
    return truncateIp(src.realIp);
  }
  if (src.remoteAddr) {
    return truncateIp(src.remoteAddr);
  }
  return "";
}
