/**
 * Shared logger factory (#575).
 *
 * Before this module landed, 64 source files instantiated their own
 * `pino({ level: "info" }).child({ module: "..." })` standalone. Two
 * problems:
 *
 *   1. The `LOG_LEVEL` env var only affected the bootstrap logger.
 *      Setting `LOG_LEVEL=debug` left every other logger at info,
 *      hiding the very `logger.debug(...)` calls #579 just added.
 *   2. The bootstrap logger redacts `authorization`, `x-api-key`,
 *      `password`, `secret`, `apiKey`. Standalone loggers bypassed
 *      all of that — a misconfigured handler logging req headers
 *      would leak bearer tokens.
 *
 * `createLogger(moduleName)` returns a child of a single process-wide
 * pino root configured with both — every consumer inherits both knobs
 * for free.
 *
 * Why a factory not an injected logger: dozens of small clients /
 * utils have a top-of-file `const logger = ...` for one-or-two
 * `logger.debug` calls. Threading a logger through every constructor
 * would be a much larger refactor with little payoff for those leaf
 * modules. The factory is a drop-in replacement for the previous
 * pattern.
 *
 * The bootstrap-level pino instance (constructed in `bootstrap.ts`
 * with `service: "ornn-api"`) is intentionally separate — it logs
 * the request/response pair with extra `service` metadata that
 * module loggers don't need. Both inherit the same env-driven level
 * + redaction.
 *
 * @module shared/logger
 */

import pino, { type Logger } from "pino";

/**
 * Re-export the pino `Logger` type so consumers don't need to
 * import `pino` directly just for the type. Eliminates the last
 * reason a domain file would have to know about pino at all.
 */
export type { Logger };

/**
 * Read once at module load so every call to `createLogger()` sees
 * the same level. Re-importing this module doesn't re-read env —
 * tests that need to swap LOG_LEVEL mid-process should set env
 * BEFORE the first import.
 */
const LEVEL = process.env.LOG_LEVEL ?? "info";

/**
 * Default redaction rules. Mirrors the bootstrap pino exactly so
 * module loggers can't accidentally log a bearer token. Adding new
 * sensitive fields here updates every logger in the codebase.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  'req.headers["x-api-key"]',
  "*.password",
  "*.secret",
  "*.apiKey",
];

/**
 * Single process-wide root. Children created via `createLogger()`
 * inherit `level` + `redact` automatically.
 */
const root = pino({
  level: LEVEL,
  redact: { paths: REDACT_PATHS },
});

/**
 * Returns a logger pre-bound to `{ module: moduleName }`. Drop-in
 * replacement for the previous `pino({ level: "info" }).child({
 * module: ... })` pattern across `ornn-api`.
 */
export function createLogger(moduleName: string): Logger {
  return root.child({ module: moduleName });
}
