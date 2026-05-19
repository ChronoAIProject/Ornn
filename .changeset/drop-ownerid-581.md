---
"ornn-api": minor
"ornn-web": patch
"@chronoai/ornn-sdk": minor
---

**BREAKING:** drop the legacy `ownerId` field from skill responses (#581). The field was a no-op back-compat mirror of `createdBy` for an old "org-as-owner" design that visibility logic no longer consults — `createdBy` + `sharedWithUsers` + `sharedWithOrgs` is the authoritative ownership model.

Removed from:

- `ornn-api` — `SkillDocument`, `SkillDetailResponse`, `SkillSearchItem`, repository write path, search service mapping, routes response shape. No DB migration ships; old documents keep the field in storage, code just stops reading it.
- `@chronoai/ornn-sdk` (TypeScript) — `SkillDetail.ownerId` dropped.
- `ornn-sdk` (Python) — `SkillDetail.owner_id` dropped; `from_dict` tolerates the field appearing on stale responses by ignoring it.
- `ornn-web` — `SkillSearchResult.ownerId` dropped.

Also clears three more dead exports flagged in the same issue:

- `clients/nyxid/auth.ts` + its colocated test (the `AuthClient` was never mounted — its consumer middleware was deleted earlier).
- `INTERNAL_AUTH_HEADER` constant + `ApiKeyInfo` interface (both only referenced by the now-deleted `AuthClient`).
- `createErrorHandler` factory (live error handler is `app.onError` in bootstrap; the factory had no callers).
