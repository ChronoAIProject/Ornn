/**
 * Validate the shape of a GitHub App private key before it lands in
 * settings (#441).
 *
 * Admins paste these PEM-encoded keys by hand into the platform
 * settings UI. The original endpoint only checked `typeof === "string"`,
 * which let malformed values (random whitespace, embedded NULs,
 * truncated copy-paste) write garbage that surfaced much later as
 * opaque crypto failures during a mirror run.
 *
 * This module fails fast at write time with a clear error.
 *
 * @module domains/skills/mirror/privateKeyValidation
 */

import { createPrivateKey } from "node:crypto";

/** Cap on raw PEM size. A real RSA 4096 PEM is ~3.2 KB; 8 KB is comfortable headroom. */
export const MAX_PRIVATE_KEY_BYTES = 8 * 1024;

/** Accepted PEM headers — PKCS#1 (`RSA PRIVATE KEY`) is what GitHub App downloads emit;
 *  PKCS#8 (`PRIVATE KEY`) is what `openssl pkcs8 -topk8` produces from the same key. */
const PEM_HEADER_RX = /^-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s*$/;
const PEM_FOOTER_RX = /^-----END (?:RSA |EC )?PRIVATE KEY-----\s*$/;

/** Result type — narrowed `ok` discriminator instead of throwing keeps callers free to pick the error code. */
export type ValidationResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Returns a normalised PEM string (LF line endings, no leading/trailing
 * whitespace) when the input passes every shape check, or a reason
 * string otherwise. Does not throw.
 */
export function validateGitHubAppPrivateKey(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "must be a string" };
  }

  if (raw.length === 0) {
    return { ok: false, reason: "must be a non-empty PEM string" };
  }

  if (raw.length > MAX_PRIVATE_KEY_BYTES) {
    return {
      ok: false,
      reason: `must be at most ${MAX_PRIVATE_KEY_BYTES} bytes (got ${raw.length})`,
    };
  }

  // Reject NUL and other C0 control bytes that have no business in a
  // PEM. Allow tab/CR/LF; everything else under 0x20 is junk.
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    if (ch < 0x20 && ch !== 0x09 && ch !== 0x0a && ch !== 0x0d) {
      return { ok: false, reason: `contains forbidden control byte 0x${ch.toString(16).padStart(2, "0")}` };
    }
  }

  // Normalise CRLF → LF and strip outer whitespace so the BEGIN/END
  // checks don't have to think about line endings.
  const normalised = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const lines = normalised.split("\n");
  if (lines.length < 3) {
    return { ok: false, reason: "must include a BEGIN line, base64 body, and END line" };
  }

  const first = lines[0]!.trim();
  const last = lines[lines.length - 1]!.trim();
  if (!PEM_HEADER_RX.test(first)) {
    return {
      ok: false,
      reason: "must start with `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1) or `-----BEGIN PRIVATE KEY-----` (PKCS#8)",
    };
  }
  if (!PEM_FOOTER_RX.test(last)) {
    return {
      ok: false,
      reason: "must end with the matching `-----END … PRIVATE KEY-----` line",
    };
  }

  // Body must be non-empty and base64-only (with whitespace between
  // 64-char lines tolerated).
  const body = lines.slice(1, -1).join("").replace(/\s+/g, "");
  if (body.length === 0) {
    return { ok: false, reason: "PEM body is empty" };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    return { ok: false, reason: "PEM body must be base64" };
  }

  // Final correctness check: actually parse it via Node's crypto.
  // This catches keys that pass the shape check but are corrupted /
  // truncated / for a different algorithm.
  try {
    createPrivateKey({ key: normalised, format: "pem" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `crypto.createPrivateKey rejected the value: ${detail}` };
  }

  return { ok: true, value: normalised };
}
