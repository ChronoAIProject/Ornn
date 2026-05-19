---
"ornn-api": patch
---

Enforce per-skill visibility on `GET /skills/:idOrName/json` (#567). The endpoint previously gated only on `ornn:skill:read`, so a caller who knew a private skill's name could fetch its full package contents through this route — broader than `/skills/:idOrName`, which applies `canReadSkill`. Now the JSON route loads the skill first and runs the same visibility check (`canReadSkill` against `createdBy` / `sharedWithUsers` / `sharedWithOrgs` + platform-admin permission), returning `SKILL_NOT_FOUND` for inaccessible private skills. Closes the leak surfaced by the `aevatar` `/v1/responses` Ornn bridge.
