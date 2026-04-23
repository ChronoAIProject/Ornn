---
"ornn-api": patch
---

Integration test layer: `mongodb-memory-server`-backed harness (`tests/integration/harness.ts`) boots real `bootstrap()` with an in-memory Mongo, and `tests/integration/domainSmoke.test.ts` exercises one smoke per domain (skills, skill-search, admin, me, users, playground, skill-format) plus `/livez`, `/readyz`, `/api/v1/openapi.json`. Establishes the pattern for future per-endpoint coverage. No runtime changes. Closes #102.
