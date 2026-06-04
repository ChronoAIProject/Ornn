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

let envSnapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  envSnapshot = { ...process.env };
  // Seed every required var EXCEPT ENCRYPTION_KEY so failures attribute
  // to the key under test, not to an unrelated missing var.
  process.env.MONGODB_URI = "mongodb://localhost:27017";
});

afterEach(() => {
  process.env = envSnapshot;
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

  test("loads config when ENCRYPTION_KEY is ≥32 chars", () => {
    process.env.ENCRYPTION_KEY = VALID_KEY;
    const config = loadConfig();
    expect(config.encryptionKey).toBe(VALID_KEY);
  });
});
