---
"ornn-web": patch
---

Fix the signed-out landing top nav overlapping its right-hand actions: the centered links no longer collide with the GitHub / language / theme buttons or the "Sign in" / "Get started" CTAs. The centered nav is now laid out in flow instead of absolutely positioned, and the desktop bar activates at the `lg` (1024px) breakpoint — below that it collapses to the hamburger menu, matching the design system.
