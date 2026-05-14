---
"ornn-web": patch
---

Playground Package drawer absorbs the redundant Skill drawer (`SkillPackagePreview` now renders the same identity strip on both pages, so two tabs showing the same info was confusing). Drawer width on Playground unified to the gen page's `min(960px, 65vw)`. Fixed a flex-wrapper bug where the Playground Package drawer's file viewer overflowed past the footer. `ResizablePanes` default split 26 % → 32 % so typical skill folder names like `ornn-agent-manual-cli` no longer truncate.

On the AI Skill Generation page, the Package rail tab now pulses ember-accent (steady ring + animated `ping` ripple + dot) when a new iteration lands while the drawer is closed — so multi-turn refinement gives a visible "new artifact ready" cue. Clears the moment the user opens the drawer.

Closes #551.
