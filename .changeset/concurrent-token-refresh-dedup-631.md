---
"ornn-web": patch
---

Deduplicate concurrent NyxID token-refresh requests (#631).

`authStore.refreshToken()` could fire 2–4 times within the same millisecond — `apiClient.fetchWithRetry`'s proactive `ensureFreshToken()`, its reactive 401-retry path, the scheduled `startTokenRefresh` `setTimeout`, and the `visibilitychange` handler all converge near the expiry boundary. Each fired its own `POST /oauth/token` with `grant_type=refresh_token`.

NyxID rotates the refresh token on every successful exchange. The second concurrent caller therefore lost the rotation race and got:

```json
{"error":"invalid_request","error_description":"Conflict: Refresh token was concurrently rotated, please retry"}
```

…which the SPA's `refreshToken` `catch` interpreted as a hard failure: it nulled the access + refresh tokens and surfaced an unexpected logout. Users observed it as "I came back to the tab and got logged out".

Fix funnels every caller through a single `_refreshInFlight: Promise<void> | null` slot on the store. The first caller stores the promise; subsequent callers `await` the same one. The slot is cleared in `finally` so a later (truly new) refresh starts fresh.

Slot is excluded from `partialize` — Promises aren't serialisable and the dedup window only matters within a tab's lifetime.
