---
"ornn-web": patch
---

Route `apiDelete` through `fetchWithRetry` (#578) so the proactive-refresh / 401-retry / redirect-to-login logic lives in one place instead of being copy-pasted between `GET/POST/PATCH/PUT` and DELETE. Behaviour-equivalent: DELETE still proactively refreshes, retries once on 401, redirects to `/login` if refresh fails, and surfaces non-2xx responses as `ApiClientError`. Only observable difference is the default error code on bodyless failures is now `UNKNOWN_ERROR` instead of `DELETE_FAILED` — that string was a dead default, no caller checks it.
