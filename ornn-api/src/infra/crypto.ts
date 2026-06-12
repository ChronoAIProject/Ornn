/**
 * Symmetric AES-256-GCM encryption helpers for at-rest secrets.
 *
 * Used by the platform-settings service to encrypt the LLM provider
 * `apiKey` (and any future operator-pasted secrets) before they hit
 * MongoDB. The DB only ever sees ciphertext; decryption happens at the
 * service boundary on each call.
 *
 * Format on disk:
 *   `v1:<iv-hex>:<authTag-hex>:<ciphertext-hex>`
 *
 * `v1:` is the version prefix. If we ever need to rotate the cipher
 * (e.g. AES-GCM-SIV) we'll bump to `v2:` and decrypt-on-read can
 * switch on the prefix; encrypt-on-write always emits the latest.
 *
 * Key derivation: `scryptSync(passphrase, salt, 32)` — slow on purpose
 * so a leaked DB dump can't be dictionary-attacked easily. The
 * passphrase is `ENCRYPTION_KEY` from env, the salt is a fixed
 * project-scoped string (collisions only matter cross-deployment, not
 * cross-row).
 *
 * @module infra/crypto
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "v1";
const SALT = "ornn-llm-provider-secret-salt";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM-recommended

/** Cache derived keys keyed by raw passphrase — scrypt is slow. */
const keyCache = new Map<string, Buffer>();

function deriveKey(passphrase: string): Buffer {
  let cached = keyCache.get(passphrase);
  if (!cached) {
    cached = scryptSync(passphrase, SALT, KEY_BYTES);
    keyCache.set(passphrase, cached);
  }
  return cached;
}

/**
 * Encrypt `plaintext` with the master passphrase. Returns the canonical
 * `v1:iv:tag:ct` string. Empty input → empty output (we never encrypt
 * empties; "no secret set" is a meaningful state at the DB layer).
 */
export function encryptSecret(plaintext: string, passphrase: string): string {
  if (plaintext === "") return "";
  if (!passphrase) {
    throw new Error("encryptSecret: master passphrase is required");
  }
  const key = deriveKey(passphrase);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("hex")}:${authTag.toString("hex")}:${ct.toString("hex")}`;
}

/**
 * Decrypt a `v1:`-prefixed blob. Legacy plaintext values (no prefix)
 * are returned as-is so a deploy that introduces encryption doesn't
 * break for rows written before it — they get re-encrypted on the next
 * write. Throws when the prefix is recognized but the payload is
 * malformed or auth-fails (tampered ciphertext).
 */
export function decryptSecret(value: string, passphrase: string): string {
  if (value === "") return "";
  if (!value.startsWith(`${PREFIX}:`)) {
    // Pre-encryption row, or operator-injected raw value. Pass through
    // — the next write will encrypt it.
    return value;
  }
  if (!passphrase) {
    throw new Error("decryptSecret: master passphrase is required");
  }
  const parts = value.split(":");
  if (parts.length !== 4) {
    throw new Error(`decryptSecret: malformed v1 payload (got ${parts.length} parts)`);
  }
  // Length-checked above (`parts.length !== 4` returns early) — every
  // slot is guaranteed defined. `!` is safe under noUncheckedIndexedAccess
  // (#450).
  const ivHex = parts[1]!;
  const tagHex = parts[2]!;
  const ctHex = parts[3]!;
  const key = deriveKey(passphrase);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/**
 * Mid-mask a secret for display. Keeps the first 4 and last 4
 * characters so the operator can sanity-check which key is in place
 * without exposing the body. Anything ≤ 8 chars gets fully blurred.
 *
 * Output is purely cosmetic — the bullet character `•` is the
 * sentinel the backend uses to detect "preserve existing on PATCH",
 * so this string MUST never round-trip back as a real value.
 */
export function midMaskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  return `${head}${"•".repeat(Math.max(4, value.length - 8))}${tail}`;
}

/** Alias for `midMaskSecret`. */
export function midMaskString(value: string): string {
  return midMaskSecret(value);
}

/** True if `value` is the mid-mask sentinel (contains the bullet character). */
export function isMidMaskSentinel(value: string): boolean {
  return value.includes("•");
}

// ---------------------------------------------------------------------------
// Redaction sentinels (settings export / import)
// ---------------------------------------------------------------------------

/**
 * Build a redaction sentinel of the form `<REDACTED:fieldName>`. Used by
 * the settings export pipeline to stand in for at-rest secrets so the
 * exported JSON never carries plaintext (or ciphertext, which would be
 * useless to the importer anyway). The importer treats this token as
 * "keep DB value untouched".
 *
 * `fieldName` MUST be a simple identifier (`[a-zA-Z][a-zA-Z0-9_]*`); the
 * matcher in `isRedactionSentinel` keeps in lock-step with this charset.
 */
export function redactSentinel(fieldName: string): string {
  return `<REDACTED:${fieldName}>`;
}

const REDACTION_SENTINEL_RE = /^<REDACTED:[a-zA-Z][a-zA-Z0-9_]*>$/;

/** True iff `value` is exactly a `<REDACTED:fieldName>` sentinel. */
export function isRedactionSentinel(value: unknown): boolean {
  return typeof value === "string" && REDACTION_SENTINEL_RE.test(value);
}

/**
 * True iff `value` should be treated as "keep existing DB value" on
 * import — either a redaction sentinel (`<REDACTED:apiKey>`) or a
 * mid-mask sentinel (the bullet-character display form).
 */
export function isPreserveSentinel(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (isRedactionSentinel(value)) return true;
  return isMidMaskSentinel(value);
}
