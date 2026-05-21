---
---

Wire the README hero to swap between `hero-brand.svg` (light) and `hero-brand-dark.svg` (dark) via a `<picture>` + `prefers-color-scheme` block (#692), matching the light/dark swap the wordmark logo at the top of the README already uses. Pure markup change — the dark asset was already stored under `ornn-web/public/` (#690). Docs-only, no code or schema delta.
