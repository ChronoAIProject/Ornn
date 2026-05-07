---
"ornn-web": minor
---

feat(web): add public `/contact` page (#278) with email, GitHub, Xiaohongshu (placeholder), and workshop/location card; wire `Contact` link into both `Navbar` (app shell) and `LandingNav` (landing) — desktop + mobile collapsed panel.

Page follows DESIGN.md "Whole-App Application Guidance → App Shell": cool steel-paper page background inherited from `RootLayout`, letterpress impression on cards via `card-impression`, bracketed mono section label, Space Grotesk display headline with `<HighlighterMark>` on the emphasis noun, JetBrains Mono for technical metadata (email + repo URL), Inter body for prose. No backend / no contact form — email is a `mailto:` link, GitHub points at `https://github.com/ChronoAIProject/Ornn`. Xiaohongshu URL is a TODO marker until the real handle ships.

i18n: adds `nav.contact` and a new `contact.*` namespace in both `en.json` and `zh.json` using the same `headlineStart` / `headlineHighlight` / `headlineEnd` split pattern landing already uses for highlighter-mark headlines.
