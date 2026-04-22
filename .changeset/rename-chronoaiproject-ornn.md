---
"ornn-api": patch
"ornn-web": patch
---

Update hardcoded repository URLs after transfer from `aevatarAI/chrono-ornn` to `ChronoAIProject/Ornn`.

Replaces 18 references across 11 files:

- `.changeset/config.json` — `"repo": "ChronoAIProject/Ornn"` so auto-generated CHANGELOG PR links point to the new repo from the next release forward.
- `CLAUDE.md` — Releases and issue-tracker URLs.
- `docs/conventions.md` — Error `type` URL, deprecation `Link` target.
- `docs/ARCHITECTURE.md` — Refactor milestone URL.
- `ornn-web/src/components/layout/Navbar.tsx` — Navbar GitHub icon link.
- `ornn-api/docs/site/{en,zh}/*.md` — Six user-facing developer-guide pages that instruct AI agents to fetch `.ornn-apis/` core skills from the repo.

GitHub serves URL redirects from the old location, so old PR / issue / blob / tree URLs continue to resolve; this PR updates the text so links render with the correct canonical URL and do not decay if the redirect ever drops.
