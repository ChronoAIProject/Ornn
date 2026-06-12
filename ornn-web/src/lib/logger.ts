/**
 * Frontend logger (#584).
 *
 * In **development** (`import.meta.env.MODE !== "production"`) every
 * level forwards to the corresponding `console` method so debugging
 * still works as before.
 *
 * In **production** all levels are no-ops. Auth lifecycle events,
 * analytics ticks, and apiClient errors previously leaked token
 * metadata (refresh timing, token expiry, auth user ids) to browser
 * devtools where it persisted across the session.
 *
 * `error` is the only level that always logs in dev; in prod even
 * errors are dropped — the right place for production error reporting
 * is a real sink (Sentry-style) wired in separately, not browser
 * devtools.
 *
 * Tags are required so the module of origin is visible in dev logs.
 *
 * @module lib/logger
 */

const IS_DEV = import.meta.env.MODE !== "production";

export interface ScopedLogger {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  debug: (msg: string, data?: unknown) => void;
}

export function createLogger(tag: string): ScopedLogger {
  const prefix = `[${tag}]`;
  if (!IS_DEV) {
    const noop = () => {};
    return { info: noop, warn: noop, error: noop, debug: noop };
  }
  return {
    info: (msg, data) => console.log(`${prefix} ${msg}`, data ?? ""),
    warn: (msg, data) => console.warn(`${prefix} ${msg}`, data ?? ""),
    error: (msg, data) => console.error(`${prefix} ${msg}`, data ?? ""),
    debug: (msg, data) => console.debug(`${prefix} ${msg}`, data ?? ""),
  };
}
