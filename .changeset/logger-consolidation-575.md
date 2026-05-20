---
"ornn-api": patch
---

Consolidate 61 standalone `pino({ level: "info" })` loggers behind a single `createLogger(moduleName)` factory (#575). Before this PR, every module had its own pino instance — neither the `LOG_LEVEL` env var nor the bootstrap logger's redaction rules (`authorization`, `x-api-key`, `password`, `secret`, `apiKey`) made it past the bootstrap. Setting `LOG_LEVEL=debug` to debug a request silently no-op'd on 64 of 65 logger instances, hiding exactly the `logger.debug(...)` calls #579 just added.

New `ornn-api/src/shared/logger.ts` exposes `createLogger(name)` — drop-in replacement for the old pattern. The factory reads `LOG_LEVEL` from env once at module load and applies the same redaction rules the bootstrap pino uses. Every module logger created via the factory inherits both.

61 sites swept across `ornn-api/src`. The 3 remaining standalone pinos are intentionally-silent test loggers (`pino({ level: "silent" })`) — they suppress output in test runs and aren't a candidate for the factory.

Bootstrap pino kept separate — it has its own `service: "ornn-api"` binding and adds `requestId` per request, which module loggers don't need.
