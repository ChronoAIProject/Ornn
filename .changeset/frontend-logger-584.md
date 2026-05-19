---
"ornn-web": patch
---

Production-mode console silencing for auth + analytics + apiClient + activityApi (#584). Introduces `ornn-web/src/lib/logger.ts` — a `createLogger(tag)` factory that emits via `console` in development and no-ops in production. Replaces the four ad-hoc per-module loggers that previously leaked auth lifecycle metadata (refresh timing, token expiry, user ids) to browser devtools where it persisted across the session. Dev experience unchanged.
