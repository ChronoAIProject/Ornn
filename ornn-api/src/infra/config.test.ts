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

const VALID_KEY = "test-encryption-key-32-chars-min-12345";

// Per-key save/restore (the #816 class). Never rebind process.env — that
// leaks set-but-not-snapshotted state into sibling test files. Capture the
// ORIGINAL value of exactly the keys this file touches (undefined vs string)
// once, mutate via direct assignment per case, then restore each key
// individually in afterEach. Same idiom as safeFetch.test.ts.
const ORIGINAL_ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ORIGINAL_MONGODB_URI = process.env.MONGODB_URI;

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
