/**
 * Unit tests for `infra/crypto`. UT-CRYPTO-001..010.
 *
 * @module infra/crypto.test
 */

import { describe, expect, it } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  isMidMaskSentinel,
  isPreserveSentinel,
  isRedactionSentinel,
  midMaskSecret,
  midMaskString,
  redactSentinel,
} from "./crypto";

const KEY = "ornn-test-passphrase-32-chars-min-okOK";

describe("infra/crypto", () => {
  it("UT-CRYPTO-001: AES-256-GCM round-trip", () => {
    const ct = encryptSecret("sk-real-secret-value", KEY);
    expect(ct).toMatch(/^v1:/);
    expect(decryptSecret(ct, KEY)).toBe("sk-real-secret-value");
  });

  it("UT-CRYPTO-002: random IV per call yields distinct ciphertexts", () => {
    const a = encryptSecret("hello", KEY);
    const b = encryptSecret("hello", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("hello");
    expect(decryptSecret(b, KEY)).toBe("hello");
  });

  it("UT-CRYPTO-003: tampered ciphertext rejected by auth tag", () => {
    const ct = encryptSecret("plaintext", KEY);
    // Flip a single hex char in the ciphertext segment.
    const parts = ct.split(":");
    parts[3] = parts[3].startsWith("a")
      ? `b${parts[3].slice(1)}`
      : `a${parts[3].slice(1)}`;
    const tampered = parts.join(":");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it("UT-CRYPTO-004: redactSentinel formats `<REDACTED:fieldName>`", () => {
    expect(redactSentinel("apiKey")).toBe("<REDACTED:apiKey>");
    expect(redactSentinel("clientSecret")).toBe("<REDACTED:clientSecret>");
  });

  it("UT-CRYPTO-005: isRedactionSentinel matches exact form", () => {
    expect(isRedactionSentinel("<REDACTED:apiKey>")).toBe(true);
    expect(isRedactionSentinel("<REDACTED:client_secret>")).toBe(true);
  });

  it("UT-CRYPTO-006: isRedactionSentinel rejects real values", () => {
    expect(isRedactionSentinel("sk-real")).toBe(false);
    expect(isRedactionSentinel("<REDACTED:>")).toBe(false);
    expect(isRedactionSentinel("<redacted:apiKey>")).toBe(false);
    expect(isRedactionSentinel(undefined)).toBe(false);
  });

  it("UT-CRYPTO-007: midMask of short string fully obscures", () => {
    expect(midMaskSecret("short")).toBe("•••••");
    expect(midMaskSecret("ab")).toBe("••••");
  });

  it("UT-CRYPTO-008: midMask of long string keeps first 4 + last 4", () => {
    const masked = midMaskSecret("sk-abcdefghijklmnop1234");
    expect(masked.startsWith("sk-a")).toBe(true);
    expect(masked.endsWith("1234")).toBe(true);
    expect(masked.includes("•")).toBe(true);
    // midMaskString is an alias.
    expect(midMaskString("sk-abcdefghijklmnop1234")).toBe(masked);
  });

  it("UT-CRYPTO-009: isMidMaskSentinel and isPreserveSentinel", () => {
    const masked = midMaskSecret("sk-abcdefghijklmnop1234");
    expect(isMidMaskSentinel(masked)).toBe(true);
    expect(isPreserveSentinel(masked)).toBe(true);
    expect(isPreserveSentinel("<REDACTED:apiKey>")).toBe(true);
    expect(isPreserveSentinel("real-value")).toBe(false);
  });

  it("UT-CRYPTO-010: empty passphrase fails fast on encrypt", () => {
    expect(() => encryptSecret("anything", "")).toThrow(
      /master passphrase is required/,
    );
  });
});
