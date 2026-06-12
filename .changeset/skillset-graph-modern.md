---
"ornn-web": patch
---

Modernize the member-dependency graph (#1092): replace react-flow's plain box nodes with a custom Forge card node — a code-glyph icon (arc-blue) + skill name + version, hairline border, letterpress hard-offset shadow, ember border on hover/selected. The read-only detail-page graph now also gets directed arc-blue edges with arrowheads (previously unstyled), and both the editor and read-only canvases gain a faint blueprint grid + vignette. Tokens-only per DESIGN.md (arc-blue diagrammatic accent, ember action accent, letterpress — no soft glow or gradient).
