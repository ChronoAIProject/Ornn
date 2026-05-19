---
"ornn-web": patch
---

Render a "Skill not found" state on Playground when the API returns 404 (#563). The page previously gated only on `skillLoading` — once loading completed, missing `skill` data still rendered the full playground UI (starter prompts, chat input, ENV drawer chrome) for unauthorized users hitting a private skill's URL directly. Backend already returned `SKILL_NOT_FOUND` via the [#567](https://github.com/ChronoAIProject/issues/567) visibility check; this PR is the matching client gate that doesn't paint the surface when the data isn't allowed. New i18n keys `playground.notFoundTitle` / `playground.notFoundBody` (EN + ZH).
