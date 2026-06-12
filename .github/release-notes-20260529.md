## Fixed

- Returning to a tab no longer triggers an unexpected logout.
- Saving a skill and logging in no longer fail with CORS errors.
- Editing a skill's package no longer returns a 404.
- Chat-completion LLM providers (e.g. DeepSeek) now work for generation.
- Saving an LLM provider keeps its model list and default.
- Playground keeps sandbox state — logins, installs — across tool calls.
- Playground shows friendly errors and a proper not-found state.
- Quota chip and banners now match the real remaining count.
- Guided/Free create shows validation errors inline and respects backend rejects.
- Frontmatter and settings errors now explain how to fix them.
- Notifications sync, scroll fully, and toasts surface above modals.
- Deactivated NyxID services no longer appear as filters.
- Permissions modal flags shares pointing at removed users or orgs.
- Skill Detail flags when the latest audit rerun failed.
- Admin papercuts — display-name search, Mirror dashboard, recipients popover.
- Private skill contents no longer leak through the JSON endpoint.
- Playground no longer routes secret env values through the LLM.
- Registry, admin tables, and creation flows now fully localize to Chinese.
- Few technical bugs fixed.

## New Feature

- Cursor pagination on skill search, with an SDK auto-pagination iterator.
- Dist-tags pin skill versions to named channels like latest and stable.
- Idempotency-Key header makes state-changing requests retry-safe.
- Sliding-window rate limiting with standard rate-limit headers.
- Published JSON Schema for SKILL.md frontmatter, for editor autocomplete.
- Subresource-Integrity hashes on version manifests for verified installs.
- Install prompt now pins pull commands to the version you're viewing.
- One-command local dev with docker-compose, plus starter example skills.
- Technical enhancement.

## Changed

- Breaking: errors now use RFC 7807 problem+json with lowercase_snake_case codes.
- Breaking: version writes require the skill GUID, not its name.
- Breaking: deprecation is now signaled via standard RFC 8594 headers.
- Breaking: removed the legacy `ownerId` field from skill responses.
- Canonical `?q=` search param; the legacy `?query=` still works.
- Resource-creating POSTs return 201 with a Location header.
- "Skip validation" on import now also bypasses frontmatter checks.
- Chat composer caps prompt length with a live counter.
- Upload size and zip-bomb limits now enforced on the backend too.
- Production builds no longer log auth or analytics to the browser console.
- Technical enhancement.
