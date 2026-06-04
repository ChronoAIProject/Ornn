/**
 * SSRF-preflight fetch wrapper (#811).
 *
 * The single shared primitive that re-resolves an outbound host at
 * fetch time and refuses private/loopback/link-local targets — the
 * DNS-rebind defense that complements write-time `validatePublicUrl`.
 * Every outbound client (chrono-storage, chrono-sandbox, NyxID,
 * LLM gateway, model-list) routes through this so a public host that
 * later flips its DNS to 169.254.169.254 / RFC1918 is caught before
 * the bearer/SA token is sent.
 *
 * Intentionally a thin wrapper: NO timeout (callers that need one pass
 * their own `init.signal`); credential redaction / response parsing
 * stay in the individual clients.
 *
 * @module infra/safeFetch
 */
import { assertPublicResolvedAddress } from "./url";

export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: '${url}'`);
  }
  await assertPublicResolvedAddress(parsed.hostname);
  return fetch(url, init);
}
