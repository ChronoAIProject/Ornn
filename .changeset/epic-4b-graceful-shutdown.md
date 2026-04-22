---
"ornn-api": patch
---

Epic 4b: graceful shutdown timeout (part of #72).

`index.ts` now wraps `shutdown()` in a 25s deadline. K8s sends `SIGTERM` then `SIGKILL`s after `terminationGracePeriodSeconds` (default 30s). A stuck Mongo close could hang past that window, leading to dirty pod termination and non-deterministic exit codes.

The new `gracefulShutdown(signal)`:
- logs the received signal
- arms a `setTimeout` with `.unref()` so it doesn't block exit when shutdown resolves early
- awaits `shutdown()` (MongoDB close etc.)
- on success: `clearTimeout` + `process.exit(0)`
- on error: `clearTimeout` + log + `process.exit(1)`
- on timeout: `logger.fatal` + `process.exit(1)`

Exit codes are now deterministic (0 for clean, 1 for any failure or timeout) so the ops dashboard can alert cleanly on non-clean shutdowns.

Scope note: the lint rule enforcing "routes do not import repositories directly" is deferred. All current offending imports are type-only (`import type`), which ESLint's `no-restricted-imports` can't ergonomically distinguish from value imports. Enforcing the real boundary (route handlers calling repo methods directly) requires first refactoring routes to depend on services only — separate follow-up issue.
