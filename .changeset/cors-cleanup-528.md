---
"ornn-web": patch
---

Remove dead `X-User-*` headers from skill-create + activity log (#528).

`createSkill` (POST /api/v1/skills — used by Free / Guided / AI-generated save) and `logActivity` (POST /api/v1/activity/login|logout) still attached `X-User-Email` / `X-User-Display-Name` headers, leftover from a pre-NyxID-proxy auth model where the backend read identity off these headers. The backend hasn't read them in months (identity comes from the proxy-forwarded JWT), and the `apiClient.createHeaders` cleanup that struck the same code from the shared client missed these two raw-`fetch` callers.

Sending them caused the browser's CORS preflight to ask permission for `X-User-Email` and `X-User-Display-Name`. The backend CORS allowlist is `["Content-Type", "Authorization"]` (`bootstrap.ts:744`), so the preflight response didn't include those headers — the browser then blocked the actual `POST` with a CORS error. End user sees: "Save Skill" never completes, DevTools shows preflight `204` then a `CORS error` on the real request.

Net change: both callers now send only `Content-Type` + `Authorization` (matching the rest of the SDK), the preflight allow-headers list is fully satisfied, and the real request goes through.

This is the definitive fix for the `POST /skills` case. The `PUT /skills/:id` case tracked in #565 doesn't send `X-User-*` itself, but the parallel login-time `logActivity` failure here was producing a CORS-error toast that could be misattributed to the in-flight PUT — worth re-verifying #565 after this lands.
