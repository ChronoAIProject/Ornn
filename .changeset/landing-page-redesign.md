---
"ornn-web": minor
---

frontend: editorial-forge landing page redesign. Rebuilt `/` from scratch in the design language defined by `DESIGN.md` — paper + metal + ember palette, Fraunces / Inter / JetBrains Mono, semantic role-based tokens. The hero is a full 820vh scroll-scrubbed sequence (phone builds itself layer-by-layer while 16 skill chips fly along SVG cables from a registry rail) with a static fallback for reduced-motion + mobile viewports. Tokens for the new palette + theme-flipping gradients are added to `src/styles/neon.css` (the existing `neon-*` tokens stay for legacy pages — no new CSS file). Featured skill cards render hardcoded copy first then quietly swap to live `/api/v1/skill-search` results when available. Routes restructured so `/` lives outside `RootLayout` (the 820vh hero needs full document scroll).
