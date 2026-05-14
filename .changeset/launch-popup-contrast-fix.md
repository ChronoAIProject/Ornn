---
"ornn-web": patch
---

LaunchCelebrationPopup contrast fix (#513). Flips the popup surface from ember orange → obsidian panel with an ember accent border, so the inline GitHub repo link (previously `ember-deep` on `ember`, effectively invisible) reads clearly in ember on dark, and every body paragraph sits at near-maximum contrast against the surface. AnnouncementPopup keeps its ember plate; only the launch-day popup flips.
