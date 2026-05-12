---
"ornn-web": patch
---

Upgrade `vite` 6 → 8 and `@vitejs/plugin-react` 4 → 6. Rolldown-based build cuts production build time from ~4.8s to ~338ms. Drops the `overrides.vite: ^6.4.2` workaround from #385 — staying on vite 6 was a stopgap to dodge GHSA-p9ff-h696-f583; vite 8 is on the secure line natively.
