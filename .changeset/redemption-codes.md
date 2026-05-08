---
"ornn-api": minor
"ornn-web": minor
---

Admin-issued redeem codes for quota grants.

Admins mint single-use, time-bounded codes that carry a multi-surface grant bundle (playground / skillGen). Each code is 16 chars from a confusable-stripped alphabet; the redeem endpoint canonicalises to upper-case at the boundary so users can paste in any case. End users redeem from Settings → Redeem code; the grant lands on the caller's current-month bucket via the existing `QuotaService.grant()` path so existing audit + notification fanout fires.

Lifecycle: `active → redeemed | invalidated`. Concurrent redemptions of the same code are race-safe — a single atomic `findOneAndUpdate` on `(code, status: "active", expiresAt > now)` is the pivot. Admins can invalidate any `active` code; redeemed and already-invalidated codes return 409.

New surfaces:

- `POST /api/v1/admin/redemption-codes` (mint), `GET` (list/filter/search), `GET /:id` (detail), `POST /:id/invalidate`. Gated on `QUOTA_ADMIN_PERMISSION`.
- `POST /api/v1/me/redemption-codes/redeem`, `GET /api/v1/me/redemption-codes/history`. Per-error-code messages on the user form (`NOT_FOUND` / `EXPIRED` / `INVALIDATED` / `ALREADY_REDEEMED`).
- Admin page at `/admin/redemption-codes`; user form on the Settings page.

Closes #306.
