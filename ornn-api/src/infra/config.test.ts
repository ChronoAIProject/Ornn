/**
 * loadConfig() env-validation tests (#821).
 *
 * Locks the ENCRYPTION_KEY contract the interface + schema JSDoc now
 * claim: mandatory, ≥32 chars, NO dev fallback, fail-fast with a
 * structured ConfigError. Asserts on ConfigError identity + the
 * ZodIssue path (not message text, which is brittle).
 *
 * @module infra/config.test
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "./config";
import { DEFAULT_NYXID_AUDIENCE } from "../middleware/nyxidIdentity";

const VALID_KEY = "test-encryption-key-32-chars-min-12345";

// Per-key save/restore (the #816 class). Never rebind process.env — that
// leaks set-but-not-snapshotted state into sibling test files. Capture the
// ORIGINAL value of exactly the keys this file touches (undefined vs string)
// once, mutate via direct assignment per case, then restore each key
// individually in afterEach. Same idiom as safeFetch.test.ts.
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;
const ORIGINAL_NYXID_ISSUER = process.env.NYXID_ISSUER;
const ORIGINAL_NYXID_JWKS_URL = process.env.NYXID_JWKS_URL;
const ORIGINAL_NYXID_AUDIENCE = process.env.NYXID_AUDIENCE;
const ORIGINAL_NYXID_CLOCK_SKEW_SECONDS = process.env.NYXID_CLOCK_SKEW_SECONDS;
const ORIGINAL_TRUST_IDENTITY_HEADERS = process.env.ORNN_TRUST_IDENTITY_HEADERS;

beforeEach(() => {
  // Seed every required var EXCEPT ENCRYPTION_KEY so failures attribute
  // to the key under test, not to an unrelated missing var.
  process.env.MONGODB_URI = "mongodb://localhost:27017";
});

afterEach(() => {
  if (ORIGINAL_ENCRYPTION_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_ENCRYPTION_KEY;

  if (ORIGINAL_MONGODB_URI === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = ORIGINAL_MONGODB_URI;

  if (ORIGINAL_NYXID_ISSUER === undefined) delete process.env.NYXID_ISSUER;
  else process.env.NYXID_ISSUER = ORIGINAL_NYXID_ISSUER;
  if (ORIGINAL_NYXID_JWKS_URL === undefined) delete process.env.NYXID_JWKS_URL;
  else process.env.NYXID_JWKS_URL = ORIGINAL_NYXID_JWKS_URL;
  if (ORIGINAL_NYXID_AUDIENCE === undefined) delete process.env.NYXID_AUDIENCE;
  else process.env.NYXID_AUDIENCE = ORIGINAL_NYXID_AUDIENCE;
  if (ORIGINAL_NYXID_CLOCK_SKEW_SECONDS === undefined) delete process.env.NYXID_CLOCK_SKEW_SECONDS;
  else process.env.NYXID_CLOCK_SKEW_SECONDS = ORIGINAL_NYXID_CLOCK_SKEW_SECONDS;
  if (ORIGINAL_TRUST_IDENTITY_HEADERS === undefined) delete process.env.ORNN_TRUST_IDENTITY_HEADERS;
  else process.env.ORNN_TRUST_IDENTITY_HEADERS = ORIGINAL_TRUST_IDENTITY_HEADERS;
});

describe("loadConfig — ENCRYPTION_KEY", () => {
  test("throws ConfigError when ENCRYPTION_KEY is unset", () => {
    delete process.env.ENCRYPTION_KEY;
    try {
      loadConfig();
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(
        (err as ConfigError).issues.some((i) => i.path.includes("ENCRYPTION_KEY")),
      ).toBe(true);
    }
  });

  test("throws ConfigError when ENCRYPTION_KEY is shorter than 32 chars", () => {
    process.env.ENCRYPTION_KEY = "too-short";
    try {
      loadConfig();
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(
        (err as ConfigError).issues.some((i) => i.path.includes("ENCRYPTION_KEY")),
      ).toBe(true);
    }
  });

  test("throws ConfigError when ENCRYPTION_KEY is exactly 31 chars (boundary)", () => {
    const KEY_31 = "a".repeat(31);
    expect(KEY_31.length).toBe(31);
    process.env.ENCRYPTION_KEY = KEY_31;
    try {
      loadConfig();
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(
        (err as ConfigError).issues.some((i) => i.path.includes("ENCRYPTION_KEY")),
      ).toBe(true);
    }
  });

  test("throws ConfigError when ENCRYPTION_KEY is the empty string (envsubst footgun)", () => {
    process.env.ENCRYPTION_KEY = "";
    try {
      loadConfig();
      throw new Error("expected loadConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect(
        (err as ConfigError).issues.some((i) => i.path.includes("ENCRYPTION_KEY")),
      ).toBe(true);
    }
  });

  test("loads config when ENCRYPTION_KEY is exactly 32 chars (boundary)", () => {
    const KEY_32 = "a".repeat(32);
    expect(KEY_32.length).toBe(32);
    process.env.ENCRYPTION_KEY = KEY_32;
    const config = loadConfig();
    expect(config.encryptionKey).toBe(KEY_32);
  });

  test("loads config when ENCRYPTION_KEY is ≥32 chars", () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const config = loadConfig();
    expect(config.encryptionKey).toBe(VALID_KEY);
  });
});

describe("loadConfig — NyxID identity verification", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    delete process.env.NYXID_ISSUER;
    delete process.env.NYXID_JWKS_URL;
    delete process.env.NYXID_AUDIENCE;
    delete process.env.NYXID_CLOCK_SKEW_SECONDS;
    delete process.env.ORNN_TRUST_IDENTITY_HEADERS;
  });

  test("uses production issuer/JWKS/audience defaults and disables header trust", () => {
    const config = loadConfig();
    expect(config.nyxidIssuer).toBe("https://nyx-api.chrono-ai.fun");
    expect(config.nyxidJwksUrl).toBe("https://nyx-api.chrono-ai.fun/.well-known/jwks.json");
    expect(config.nyxidAudience).toBe(DEFAULT_NYXID_AUDIENCE);
    expect(config.nyxidClockSkewSeconds).toBe(5);
    expect(config.trustIdentityHeaders).toBe(false);
  });

  test("accepts an explicit issuer, JWKS URL, audience, skew, and legacy opt-in", () => {
    process.env.NYXID_ISSUER = "https://nyx.example.test";
    process.env.NYXID_JWKS_URL = "https://nyx.example.test/.well-known/jwks.json";
    process.env.NYXID_AUDIENCE = "https://ornn.example.test";
    process.env.NYXID_CLOCK_SKEW_SECONDS = "9";
    process.env.ORNN_TRUST_IDENTITY_HEADERS = "true";

    const config = loadConfig();
    expect(config.nyxidIssuer).toBe("https://nyx.example.test");
    expect(config.nyxidJwksUrl).toBe("https://nyx.example.test/.well-known/jwks.json");
    expect(config.nyxidAudience).toBe("https://ornn.example.test");
    expect(config.nyxidClockSkewSeconds).toBe(9);
    expect(config.trustIdentityHeaders).toBe(true);
  });
});
