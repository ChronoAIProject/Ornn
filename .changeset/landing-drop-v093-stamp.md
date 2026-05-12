---
"ornn-web": patch
---

Remove the "NOW FORGING · v 0.9.3" badge from the landing hero — it was a stale dev-time build-status stamp that didn't belong on the public landing. Drops the `<Stamp>` usage from both the scrub and static hero variants, the `landing.nowForging` i18n keys, and the unused `Stamp` import.

Closes #333.
