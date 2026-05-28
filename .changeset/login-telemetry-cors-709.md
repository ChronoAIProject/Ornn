---
"ornn-web": patch
---

`logActivity` no longer sets `credentials: "include"`, unblocking the post-OAuth `POST /api/v1/activity/login` call on the hosted environment (#709).

The endpoint is Bearer-token-authenticated; it never read cookies. The lone `credentials: "include"` set in `activityApi.ts` (the rest of the SPA's `apiClient` calls never set it) forced the browser to demand `Access-Control-Allow-Credentials: true` plus a specific (non-`*`) `Access-Control-Allow-Origin` on the preflight response. The NyxID proxy doesn't emit those for this endpoint, so the preflight failed and every login on `ornn.chrono-ai.fun` ate a `TypeError: Failed to fetch`. Authenticated GETs through the same proxy keep working because they're simple requests (no preflight) and the rest of the POST endpoints don't set `credentials`.

Dropping the flag brings this call into line with every other authenticated POST in the SPA and the preflight succeeds.
