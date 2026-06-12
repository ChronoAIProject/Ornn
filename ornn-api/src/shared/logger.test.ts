/**
 * Tests for the shared logger factory (#575).
 *
 * The factory replaces 64 standalone `pino({ level: "info" })` calls
 * across ornn-api. These tests pin the two properties that broke
 * before #575:
 *
 *   1. Loggers respect `LOG_LEVEL` env (set before module load).
 *   2. Loggers redact sensitive fields (`*.apiKey`, `*.password`,
 *      `*.secret`, `req.headers.authorization`, etc).
 *
 * @module shared/logger.test
 */

import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";
import { createLogger, REDACT_PATHS } from "./logger";

describe("createLogger (#575)", () => {
  test("returns a logger bound to the module name", () => {
    const logger = createLogger("test-module");
    expect(logger).toBeDefined();
    // pino loggers don't expose their bindings publicly — verify
    // shape via the methods they're guaranteed to have.
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  test("multiple calls return independent child loggers", () => {
    const a = createLogger("module-a");
    const b = createLogger("module-b");
    expect(a).not.toBe(b);
  });

  test("inherits `level` from the shared root (LOG_LEVEL env)", () => {
    const logger = createLogger("level-test");
    // process.env.LOG_LEVEL is undefined in this test env → defaults
    // to "info". The level getter on pino reflects the active level.
    expect(logger.level).toBe(process.env.LOG_LEVEL ?? "info");
  });

  test("supports the same call sites the old pattern did", () => {
    // The 64 sites this replaces all call .info / .debug / .warn /
    // .error with an object payload + message string. Smoke-test
    // each shape so a future pino major-version bump that changes
    // the signature would fail this test.
    const logger = createLogger("smoke");
    expect(() => logger.info({ foo: 1 }, "hello")).not.toThrow();
    expect(() => logger.debug({ bar: 2 }, "world")).not.toThrow();
    expect(() => logger.warn({ baz: 3 }, "warning")).not.toThrow();
    expect(() => logger.error({ err: new Error("x") }, "boom")).not.toThrow();
  });

  test("child loggers can be created from a created logger", () => {
    // The bootstrap path layers another `.child({ requestId })` on
    // top of the module logger; verify that still works through the
    // factory's output.
    const parent = createLogger("parent");
    const child = parent.child({ requestId: "req_test" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });

  test("REDACT_PATHS censors token-family secrets at depth-2 (#817)", () => {
    // Build our OWN pino instance from the exported constant + a
    // minimal capture stream, deliberately avoiding pino-pretty and any
    // env/import-order coupling. This makes the assertion fully
    // order-independent — it behaves identically in a scoped `bun test
    // src/shared/` run and in the single-process full suite (the trap
    // that broke #816's CI).
    //
    // The `*.field` redaction wildcard matches EXACTLY one level, so we
    // log a depth-2 object (`user.token`, ...). A depth-1 or depth-3
    // payload would NOT match and the test would silently pass without
    // proving anything.
    const chunks: string[] = [];
    const captureStream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const logger = pino({ redact: { paths: REDACT_PATHS } }, captureStream);

    logger.info(
      {
        user: {
          token: "RAW_T",
          accessToken: "RAW_AT",
          userAccessToken: "RAW_UAT",
          clientSecret: "RAW_CS",
          privateKey: "RAW_PK",
        },
      },
      "redaction check",
    );

    const serialized = chunks.join("");
    const parsed = JSON.parse(serialized);

    expect(parsed.user.token).toBe("[Redacted]");
    expect(parsed.user.accessToken).toBe("[Redacted]");
    expect(parsed.user.userAccessToken).toBe("[Redacted]");
    expect(parsed.user.clientSecret).toBe("[Redacted]");
    expect(parsed.user.privateKey).toBe("[Redacted]");

    // Belt-and-braces: no raw secret value survives anywhere in the
    // serialized line, not just under the expected keys.
    for (const sentinel of [
      "RAW_T",
      "RAW_AT",
      "RAW_UAT",
      "RAW_CS",
      "RAW_PK",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});
