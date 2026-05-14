---
"ornn-web": patch
---

Landing-page launch-celebration popup. Hardcoded, bilingual (en / zh) modal that fires on every visit to `/` for both anonymous and signed-in users, announcing the public-launch free-credit promo (200 Playground + 200 Skill Generation credits for the first 500 users who star the GitHub repo and sign in). Dismissal is session-only — no localStorage write — so the popup reappears on any return visit until the component is unmounted from `LandingPage` at the end of the launch window. Independent of the dynamic announcements collection on purpose.
