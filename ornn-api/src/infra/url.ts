/**
 * URL safety helpers.
 *
 * Admin-supplied URLs (NyxID base, LLM gateway, model-list endpoint,
 * chrono-storage / chrono-sandbox, OAuth2 token URL) are operator-
 * controllable runtime values. Without a guard, an admin (or a
 * compromised admin session) can point them at:
 *   • cloud metadata endpoints — `http://169.254.169.254/...` exfils
 *     EC2/GCE instance creds.
 *   • localhost / loopback — talks to internal Redis / Mongo / Vault.
 *   • RFC1918 / link-local — pivots inside the cluster network.
 *
 * The OAuth2 token-exchange path POSTs `client_id` + `client_secret` to
 * the operator-supplied `tokenUrl`; an attacker-controlled host exfils
 * those creds on first use.
 *
 * `isPrivateHost(host)` rejects:
 *   • `localhost`, `127.0.0.0/8`, `0.0.0.0`
 *   • `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
 *   • `169.254.0.0/16`         (link-local, AWS/GCP metadata)
 *   • `::1`, `fc00::/7`, `fe80::/10`, `::ffff:<v4>` mapped forms
 *
 * `requirePublicUrl(value)` is the predicate the Zod schemas call. It:
 *   • accepts empty string ("not configured" is a meaningful state).
 *   • requires `http://` or `https://` scheme.
 *   • rejects bracket-notation IPv6 literals that resolve to a private
 *     range.
 *   • allows operator-explicit bypass via `ORNN_URL_ALLOWLIST_CIDR`
 *     (comma-separated host/CIDR list) for single-VPC deployments
 *     where the dependency genuinely lives at a private address.
 *
 * Schema-layer validation is the first line of defence; engineer-3's
 * fetch-time DNS-rebind defense uses the same `isPrivateHost` against
 * the resolved IP after `dns.lookup()` to close the second-resolve gap.
 *
 * @module infra/url
 */

const ALLOWLIST_ENV = "ORNN_URL_ALLOWLIST_CIDR";

/**
 * Operator-explicit bypass list. Read once per call (dev convenience —
 * the env doesn't change at runtime in any sane deployment, so a cache
 * would be premature). Entries are bare hostnames (`internal-llm.svc`),
 * IPv4 literals (`10.42.0.7`), or IPv4 CIDRs (`10.42.0.0/16`).
 *
 * IPv6 CIDRs are not supported in v1 — operators with IPv6 dependencies
 * must allowlist by hostname.
 */
function readAllowlist(): ReadonlyArray<string> {
  const raw = process.env[ALLOWLIST_ENV] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse an IPv4 address. Returns `null` if the string is not a valid
 * IPv4 dotted-quad. We deliberately do not accept IPv4 in any form
 * (octal, decimal, hex) other than dotted-quad — historical Node /
 * libc parsers accept e.g. `2130706433` as `127.0.0.1`, which is a
 * known SSRF bypass class.
 */
function parseIpv4(host: string): number | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

interface Cidr {
  readonly base: number;
  readonly maskBits: number;
}

function parseCidr(spec: string): Cidr | null {
  const [hostPart, bitsPart] = spec.split("/");
  const base = parseIpv4(hostPart);
  if (base === null) return null;
  const maskBits = bitsPart ? Number(bitsPart) : 32;
  if (!Number.isInteger(maskBits) || maskBits < 0 || maskBits > 32) return null;
  return { base, maskBits };
}

function ipv4InCidr(ip: number, cidr: Cidr): boolean {
  if (cidr.maskBits === 0) return true;
  const mask = cidr.maskBits === 32 ? 0xff_ff_ff_ff : ((0xff_ff_ff_ff << (32 - cidr.maskBits)) >>> 0);
  return (ip & mask) === (cidr.base & mask);
}

const PRIVATE_CIDRS: ReadonlyArray<Cidr> = [
  parseCidr("10.0.0.0/8")!,
  parseCidr("172.16.0.0/12")!,
  parseCidr("192.168.0.0/16")!,
  parseCidr("127.0.0.0/8")!,
  parseCidr("169.254.0.0/16")!,
  parseCidr("0.0.0.0/8")!,
];

/**
 * True if `host` (a hostname or IP literal, no port, no brackets) is
 * disallowed by the SSRF policy.
 *
 * IPv6: matched via prefix because we don't ship a full IPv6 parser.
 * `::1` is loopback; `fc00::/7` ULA; `fe80::/10` link-local. We also
 * reject `::ffff:<ipv4>` mapped form by checking the suffix against
 * the IPv4 ruleset.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.length === 0) return true;
  if (h === "localhost") return true;

  // IPv6 literal (already stripped of brackets by the URL parser).
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (h.startsWith("fe80:") || h.startsWith("fe80::")) return true;
    // `fc00::/7` covers `fc00::` through `fdff::`.
    if (h.startsWith("fc") || h.startsWith("fd")) {
      const first = h.split(":")[0];
      if (/^f[cd][0-9a-f]{0,2}$/.test(first)) return true;
    }
    // `::ffff:<v4>` mapped form.
    const mapped = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) {
      const ip = parseIpv4(mapped[1]);
      if (ip === null) return true; // malformed — reject conservatively
      return PRIVATE_CIDRS.some((c) => ipv4InCidr(ip, c));
    }
    // Unknown IPv6 — reject by default for SSRF safety; operators with
    // a legitimate v6 dep must use the hostname allowlist.
    return true;
  }

  const ip = parseIpv4(h);
  if (ip !== null) {
    return PRIVATE_CIDRS.some((c) => ipv4InCidr(ip, c));
  }

  // Hostname — heuristics for the loopback aliases and `*.localhost`.
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local")) return true; // mDNS — refuse cross-network access

  return false;
}

/**
 * Result of `validatePublicUrl` — caller can drop the `reason` into a
 * Zod issue message.
 */
export interface UrlValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

/**
 * Parse `value` as an `http(s)://` URL and check its host against the
 * SSRF policy + the operator allowlist. Returns `{ ok: true }` for the
 * empty string ("not configured" is allowed).
 */
export function validatePublicUrl(value: string): UrlValidationResult {
  if (value === "") return { ok: true };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "must be a valid http(s):// URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "must use http:// or https:// scheme" };
  }
  // `URL.hostname` strips brackets from `[::1]` automatically.
  const host = parsed.hostname.toLowerCase();
  const allowlist = readAllowlist();

  // Operator allowlist — bare hostname match or IPv4-CIDR match.
  for (const entry of allowlist) {
    if (entry === host) return { ok: true };
    const cidr = parseCidr(entry);
    if (cidr) {
      const ip = parseIpv4(host);
      if (ip !== null && ipv4InCidr(ip, cidr)) return { ok: true };
    }
  }

  if (isPrivateHost(host)) {
    return {
      ok: false,
      reason:
        "host resolves to a private / loopback / link-local range; set ORNN_URL_ALLOWLIST_CIDR to allow",
    };
  }
  return { ok: true };
}

/**
 * Boolean variant for use as a Zod `.refine()` predicate. Callers should
 * pair it with a `message` that mentions the SSRF guard so operators
 * can find this module quickly.
 */
export function requirePublicUrl(value: string): boolean {
  return validatePublicUrl(value).ok;
}

/**
 * Zod-friendly error message for the public URL refinement. Single
 * source of truth so all sections render the same hint.
 */
export const PUBLIC_URL_REFUSAL =
  "URL host is private/loopback/link-local; set ORNN_URL_ALLOWLIST_CIDR to allow";

/**
 * Fetch-time DNS-rebind re-check.
 *
 * `validatePublicUrl` only sees the URL string — it can refuse literal
 * private IPs and obvious loopback hostnames, but a public hostname
 * that resolves to `169.254.169.254` (cloud metadata) at fetch time
 * slips through. This helper plugs that gap: resolve the hostname via
 * `dns.lookup` and run the same `isPrivateHost` predicate against the
 * returned IP literal. Throws `SsrfRefusalError` on the first private
 * resolution.
 *
 * Operators with a legitimate private dependency add the host or CIDR
 * to `ORNN_URL_ALLOWLIST_CIDR` (the same allowlist `validatePublicUrl`
 * consults). Allowlisted hosts skip the resolution check — saves a DNS
 * round-trip on every fetch and lets internal proxy URLs work.
 *
 * Returns `void` on success. Caller is expected to call `fetch()`
 * immediately after — the TOCTOU window between this check and the
 * actual fetch is acceptable because the kernel-level resolver cache
 * is short-lived and a hostile DNS server flipping records mid-window
 * is the rebind pattern this module already documents.
 *
 * @throws SsrfRefusalError when the resolved IP lands in a private /
 * loopback / link-local / metadata range without an allowlist match.
 */
import * as dns from "node:dns/promises";

export class SsrfRefusalError extends Error {
  constructor(host: string, resolved: string) {
    super(
      `SSRF refusal: host '${host}' resolved to private address '${resolved}'`,
    );
    this.name = "SsrfRefusalError";
  }
}

export async function assertPublicResolvedAddress(host: string): Promise<void> {
  if (!host) return;
  const allowlist = readAllowlist();
  // Fast-path: hostname is already in the operator allowlist — skip
  // resolution entirely. Matches `validatePublicUrl`'s behaviour for
  // explicit operator overrides (e.g. internal proxy hostnames).
  for (const entry of allowlist) {
    if (entry === host.toLowerCase()) return;
  }
  // Skip resolution when the URL host is already a literal IP — the
  // upstream `validatePublicUrl` call already vetted it. Cheap guard.
  if (host.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return;

  let resolved: ReadonlyArray<{ address: string; family: number }>;
  try {
    // The `{ all: true }` overload returns an array. TS's overload
    // resolution picks the single-result form unless we cast explicitly.
    resolved = (await dns.lookup(host, { all: true })) as ReadonlyArray<{
      address: string;
      family: number;
    }>;
  } catch {
    // DNS failure is the caller's problem; let `fetch` surface the
    // network error rather than synthesising one here.
    return;
  }
  for (const addr of resolved) {
    if (isPrivateHost(addr.address)) {
      throw new SsrfRefusalError(host, addr.address);
    }
  }
}
