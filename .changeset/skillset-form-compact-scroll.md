---
"ornn-web": patch
---

Fix the skillset create/edit page so it scrolls (its content was clipped by the overflow-hidden app shell — each page needs its own scroll container), and reorganize the metadata fields into a compact 2-column grid (name + version, description, kind + tags) so the member picker, dependency-graph canvas, and master prompt get the vertical room (#1074).
