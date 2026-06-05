---
"ornn-web": patch
---

Landing hero video: re-render caption-free (pure animation, no burned-in text overlays), motion-interpolate 30 → 60 fps, and ship a true 16:9 1080p frame — the old 2.4:1 canvas baked blurred letterbox bars into the pixels, which read as empty side gutters on wide viewports. object-cover now always fills the screen with real content.
