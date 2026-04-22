---
"ornn-api": patch
---

Epic 4c: ESLint rule enforcing the route↛repository boundary at import time (part of #72).

`eslint.config.js` now rejects **runtime** imports of `**/repository`, `**/repositories/*`, and `**/activityRepository` from files matching `ornn-api/src/domains/**/routes.ts`. `import type { ... }` is still allowed via `allowTypeImports: true` — routes still need repo types to type their Config interfaces.

Current state:
- All 8 existing repo imports in route files are `import type`, so lint remains clean at introduction.
- Any new code that does `import { SkillRepository } from ".../repository"` (runtime) inside a routes file fails CI.

Scope note:
- This catches the **easy** class of boundary violation (runtime repo imports).
- The **harder** class — routes invoking methods on config-passed repo instances at runtime (e.g. `skillRepo.findByGuid()` inside a handler) — needs a custom rule or a structural refactor (push remaining direct calls into services + pass services only into route factories). Tracked as follow-up; defer until the service-layer cleanup work.
