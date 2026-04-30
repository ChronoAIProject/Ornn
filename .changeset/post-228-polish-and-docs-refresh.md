---
"ornn-api": patch
"ornn-web": minor
---

Polish + docs stack landing after #228:

**ornn-api**

- Search projects `hasGithubSource: boolean` on every row so cards can render the github mark without an extra fetch.
- `mapDoc` no longer fabricates an `Invalid Date` when `source` was linked but never synced.

**ornn-web**

- Skill detail hero strip: small github icon button immediately to the left of "Try in Playground" for github-linked skills (opens the deep-linked folder in a new tab).
- Explore card: small non-clickable github mark in the badge cluster on github-linked skills.
- Advanced Options modal: fixed 80vh shell with left rail + right pane scrolling independently — long sync-preview content no longer stretches the modal.
- Build page (`/skills/new`): four mode cards now share a uniform primary CTA, pinned to the card bottom via `mt-auto`. Labels shortened (Start / Start / Start / Import) so they fit at any card width. `/skills/new/from-github` rewritten to take a single GitHub folder URL + skip-validation toggle (matches the panel UX).
- Install-skill prompt: settled on a uniform "every Ornn API call goes through NyxID's proxy regardless of skill visibility" framing — Option A NyxID CLI, Option B direct HTTPS bearer. Earlier visibility-branched iteration was reverted because anonymous fetch always 401s through the NyxID proxy layer.
- Docs site refreshed against current state. Three vs-* comparison pages (Vercel skills.sh / SkillMP / raw GitHub) folded as evidence sections inside a single "Why Ornn?" page; Technical References section dropped. New Agent Manual quick-start page describing the `ornn-agent-manual-{cli,http}` system skills and how to access them. What is Ornn + Web Users quick start refreshed.

**Skill manuals**

- `ornn-agent-manual-cli` and `ornn-agent-manual-http` bumped to v1.1. §2.7 rewritten as "Compare diff between two skill versions"; §2.10 expanded to "Delete or deprecate a single version"; new §2.14 "Link a skill to GitHub or trigger a sync" (three flows + error catalogue). `references/api-reference.md` updated for `POST /skills/pull` (`githubUrl` field), `POST /skills/:id/refresh` (`dryRun` + `skipValidation`), and a new §3.15 (`PUT /skills/:id/source`).
