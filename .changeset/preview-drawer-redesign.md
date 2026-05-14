---
"ornn-web": patch
---

Skill package preview + Playground / Skill-generation drawers — flatten layout, drop the multi-colour badge palette, pin action buttons.

- `SkillPackagePreview` identity strip is now a single flat section (no nested cards). Category renders as mono `[§ CATEGORY]` ember-bracketed, tags as `tag · tag · tag` dot-separated mono in `text-meta`. Drops the cyan/magenta/yellow/green pill palette entirely.
- Both pane headers (`FileTree`, `SkillFileViewer`) lock to `h-9` so the seam is straight; the viewer drops the redundant `FILE` prefix and shows the filename as the header.
- AI Skill Generation drawer widens (`520px` → `min(960px, 65vw)`), clears the 60 px navbar (`top-4` → `top-[68px]`), and pins the `Start over` / `Save skill` buttons at the bottom — the preview panes scroll internally instead of scrolling the whole drawer.
- Playground's three drawers (Skill / Env / Package) pick up the same voice: flat identity strip, mono status indicators (no rainbow `Badge`), `Skill page` registry link pinned to the drawer footer. Drawer widens to `min(560px, 40vw)`.

Closes #547.
