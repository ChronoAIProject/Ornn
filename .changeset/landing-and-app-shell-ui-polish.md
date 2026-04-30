---
"ornn-web": patch
---

UI polish across landing + app shell. (1) Featured-skill cards: replace the legacy `$ ornn install …` box with a wrapped row of monospace tag chips drawn from each skill's `tags` — CLI is no longer the agent path, so the card's visual gravity is preserved without implying install. (2) Active nav state: both `LandingNav` and the app-shell `Navbar` now wrap the active route's text in `<HighlighterMark>` for the same hand-drawn ember wash used on the landing headline; the singleton `<HighlighterMarkFilter />` is hoisted from `LandingPage` to `App` so every route shares the SVG turbulence filter. (3) `SkillDetailPage`: drop the `lg:h-[80vh] lg:max-h-[calc(100vh-140px)]` clamps on both columns and the right-rail's `lg:overflow-y-auto` so neither column has its own inner scroll; default flex `stretch` keeps both columns ending at the same y-pixel; responsive `min-h-[420px] lg:min-h-[680px]` keeps the file panel substantial when the package is small.
