---
"ornn-web": patch
---

Restructure the skillset detail page (#1082): the master prompt becomes the topmost full-width card (right under the hero, out of the right rail); the member-dependency graph moves into the left column above a slimmer fixed-height package viewer; and the package viewer's skill selector becomes a vertical list on the far left of the file tree (skills | files | content) instead of tabs on top. The right rail keeps metadata + resolved closure + visibility + danger; the fragile viewport-height lock is dropped in favor of natural page scroll.
