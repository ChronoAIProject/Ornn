---
"ornn-web": minor
---

feat(web): SkillDetailPage redesign — Editorial Forge wireframe v1 (#201).

The page now leads with a hero strip (icon, name, description, category + tag row, status pills for visibility / version / audit verdict / 7-day pulls, owner line, primary CTA) instead of a tall pulls chart. The pulls strip is preserved but the right rail is consolidated into 4 contextual cards: **Audit / Visibility / Versions / Danger** — each owning its concept end-to-end (verdict badge + actions).

Implements the Editorial Forge design language from `DESIGN.md`:

- Adds Editorial Forge tokens to `ornn-web/src/styles/neon.css` via `@theme` so they coexist with legacy `neon-*` tokens during migration. New utilities available app-wide: `bg-page`, `bg-panel`, `bg-card`, `bg-elevated`, `text-strong`, `text-body`, `text-meta`, `text-accent`, `bg-accent`, `text-success`/`warning`/`danger`/`info`, `border-subtle`, `border-strong-edge`, `font-display` (Fraunces), `font-reading` (Inter).
- Loads Fraunces + Inter alongside the legacy Orbitron + Rajdhani in `index.html`.
- Only `SkillDetailPage` opts into the new tokens; other pages stay on the legacy `neon-*` tokens until migrated per-page.

Closes #201.
