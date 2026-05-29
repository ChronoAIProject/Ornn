---
"ornn-web": patch
---

Fix hosted CORS failure blocking skill save / update / version-deprecation (#732). `skillApi.ts` set `credentials: "include"` on three raw-fetch calls (`createSkill`, `updateSkillPackage`, `setSkillVersionDeprecation`). These authenticate with the `Authorization: Bearer` header, never cookies, so the flag was unnecessary — and fatal: a credentialed request forbids a wildcard `Access-Control-Allow-Origin: *`, which the NyxID proxy returns, so the browser blocked every request at the CORS layer with "Failed to fetch". #528 only removed the dead `X-User-*` headers and #709 cleared the same trap in `activityApi.ts`; the `skillApi.ts` siblings were missed. Dropping `credentials: "include"` restores hosted skill creation, package update, and version deprecation.
