---
"ornn-api": patch
---

Require an explicit authorization actor on the playground chat path (drop the SYSTEM_ACTOR fallback) and de-duplicate the route-level actor builds behind a single buildActorContext helper so they cannot drift.
