---
"ornn-web": patch
---

Auth store now self-heals the "username shows as UUID" state on browser restart. When a user's NyxID `id_token` lands without `email`/`name` claims (admin-created accounts), `displayName` falls back to the NyxID GUID. The login path always kicked off a `/api/v1/me` backfill to fix this, but if the user closed the tab before that backfill resolved, the UUID got persisted and never recovered — every subsequent session, every token refresh, kept propagating it.

`initialize()` now re-runs the backfill on rehydrate whenever `user.displayName === user.id` (or email/name is empty). The check + helper are extracted so the login path and the rehydrate path share one source of truth.

Closes #316.
