/**
 * Tests for validateGitHubAppPrivateKey (#441).
 *
 * Uses a freshly-generated RSA-2048 PEM (PKCS#1) as the happy-path
 * input so the test is hermetic and the `createPrivateKey` round-trip
 * actually exercises against a real key.
 */

import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import {
  MAX_PRIVATE_KEY_BYTES,
  validateGitHubAppPrivateKey,
} from "./privateKeyValidation";

function makePkcs1Pem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs1", format: "pem" }).toString();
}

function makePkcs8Pem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("validateGitHubAppPrivateKey — happy paths", () => {
  test("PKCS#1 RSA PRIVATE KEY parses + round-trips through crypto", () => {
    const pem = makePkcs1Pem();
    const result = validateGitHubAppPrivateKey(pem);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(pem.trim());
  });

  test("PKCS#8 PRIVATE KEY accepted", () => {
    const pem = makePkcs8Pem();
    const result = validateGitHubAppPrivateKey(pem);
    expect(result.ok).toBe(true);
  });

  test("CRLF line endings normalised to LF", () => {
    const pem = makePkcs1Pem();
    const crlf = pem.replace(/\n/g, "\r\n");
    const result = validateGitHubAppPrivateKey(crlf);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toContain("\r");
  });

  test("leading + trailing whitespace stripped", () => {
    const pem = makePkcs1Pem();
    const padded = `\n  ${pem}  \n`;
    const result = validateGitHubAppPrivateKey(padded);
    expect(result.ok).toBe(true);
  });
});

describe("validateGitHubAppPrivateKey — rejections", () => {
  test("non-string", () => {
    const result = validateGitHubAppPrivateKey(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/must be a string/);
  });

  test("empty string", () => {
    const result = validateGitHubAppPrivateKey("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non-empty/);
  });

  test("oversize input fails before crypto sees it", () => {
    const big = "A".repeat(MAX_PRIVATE_KEY_BYTES + 1);
    const result = validateGitHubAppPrivateKey(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/must be at most/);
  });

  test("embedded NUL rejected", () => {
    const pem = makePkcs1Pem();
    const polluted = pem.slice(0, 50) + "\0" + pem.slice(50);
    const result = validateGitHubAppPrivateKey(polluted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/forbidden control byte/);
  });

  test("missing BEGIN line", () => {
    const result = validateGitHubAppPrivateKey("blah\nMIIBOgIBAAJB...\n-----END RSA PRIVATE KEY-----");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/BEGIN/);
  });

  test("missing END line", () => {
    const result = validateGitHubAppPrivateKey("-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAA==\nstray");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/END/);
  });

  test("non-base64 body", () => {
    const result = validateGitHubAppPrivateKey(
      "-----BEGIN RSA PRIVATE KEY-----\nnot!base?64\n-----END RSA PRIVATE KEY-----",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/base64/);
  });

  test("truncated key body fails the crypto round-trip", () => {
    const pem = makePkcs1Pem();
    const lines = pem.split("\n");
    // Drop ~half the body lines so the base64 still parses but the key doesn't.
    const truncated = [lines[0]!, lines[1]!, lines[lines.length - 2]!, lines[lines.length - 1]!].join("\n");
    const result = validateGitHubAppPrivateKey(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/crypto\.createPrivateKey rejected/);
  });
});
