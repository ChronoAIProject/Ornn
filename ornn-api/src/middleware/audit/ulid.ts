/**
 * Tiny ULID generator (no external dep).
 *
 * 26-char Crockford-base32 string: 10 chars timestamp (ms since epoch)
 * + 16 chars randomness. Lexicographic order matches creation order
 * within a process at millisecond resolution. Suitable for audit ids
 * — collision-resistant within a request lifetime, sortable on disk
 * by chronology, embeddable into MinIO object keys.
 *
 * The `ulid` npm package is well-maintained but a 4kB dep we don't
 * otherwise need. This implementation is ~30 lines and reproduces the
 * canonical alphabet + length.
 *
 * @module middleware/audit/ulid
 */

import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number, len: number): string {
  let out = "";
  let value = now;
  for (let i = len - 1; i >= 0; i--) {
    const mod = value % ENCODING_LEN;
    out = ENCODING[mod] + out;
    value = (value - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ENCODING[bytes[i] % ENCODING_LEN];
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  return encodeTime(now, TIME_LEN) + encodeRandom(RANDOM_LEN);
}
