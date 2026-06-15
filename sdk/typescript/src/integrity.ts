/**
 * Package-integrity helpers.
 *
 * The skill-detail response carries `skillHash` (hex SHA-256 of the
 * package bytes). After downloading a package from its presigned
 * object-storage URL, the SDK re-hashes the bytes and compares — an
 * SRI-style guard against a tampered or corrupted artifact. Extracted
 * from `client.ts` to keep that file under the 500-line cap and to keep
 * the WebCrypto/hex plumbing isolated from the HTTP machinery.
 *
 * @module integrity
 */

/**
 * Compute the lowercase hex SHA-256 of `bytes` via WebCrypto.
 *
 * Uses `crypto.subtle` from the global scope (available in browsers,
 * Node 20+, Bun, Deno, modern Workers). Throws a clear error if the
 * runtime exposes no WebCrypto rather than silently skipping the check.
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "OrnnClient: WebCrypto (crypto.subtle) is unavailable; cannot verify package integrity",
    );
  }
  const digest = await subtle.digest("SHA-256", bytes);
  return bufferToHex(digest);
}

/** Lowercase hex-encode an ArrayBuffer without intermediate string churn. */
function bufferToHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
