---
"ornn-api": minor
"ornn-web": patch
---

Install-card prompt now pins to the viewed version (#639).

When a user opened an older skill version (`?version=0.2`) the URL + file viewer correctly switched to that version, but the install card's prompt was still latest-shaped:

- The pull commands (`nyxid proxy request …/json` + the `curl …/json` line) had no `?version=…`, so an agent following the prompt would silently install `latest` at install time instead of the version the user was actually looking at.
- The prompt header didn't mention which version the user had viewed, so even careful agents couldn't tell.

Fix is end-to-end:

**Backend (`ornn-api`)**

- `getSkillJson(idOrName, version?)` now accepts an optional `version` query — literal `<major>.<minor>` OR a dist-tag (#463). When set, the response uses that version's `storageKey` + `metadata`; otherwise the latest package is returned (unchanged behaviour for legacy callers).
- Returns a new top-level `version` field so callers can confirm exactly which package they got.
- `GET /api/v1/skills/:idOrName/json` reads `?version=` and threads it through. Bad version → `400 invalid_version`; missing version → `404 skill_version_not_found` (RFC 7807). Visibility check unchanged.
- Bumped to **minor** because the response shape gains a new field.

**Frontend (`ornn-web`)**

- `buildTrySkillPrompt({…, version })` adds `?version=` to both pull URLs (curl + NyxID CLI via `--query version=…`), and to the footer `Ornn URL:`. Header line becomes `# Install Ornn skill: <name> @ <version>` and a "Pinned to version `<X>`" paragraph spells out why the URLs carry the query.
- `SkillInstallCard` passes the currently-viewed `skill.version` straight through, so the prompt always matches the page.
- No-version callers (theoretical "always pull latest" surfaces) are unaffected — the version is opt-in.

Pinned with 3 new `buildTrySkillPrompt.test.ts` assertions (version-pinning surfaces, no-pin parity, dist-tag passes through unchanged) and the existing 9 cases re-verified.
