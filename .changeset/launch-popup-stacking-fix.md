---
"ornn-web": patch
---

LaunchCelebrationPopup — fix letterpress plate stacking-context bug (#517). The shadow plate was a child of the card div, with `z-index: -10` to sit behind. But the card itself created a stacking context via `position: relative + z-index: 10`, so the plate's negative-z child painted **over** the card's bg instead of behind it — invisible in dark mode (both colors are dark ember tones) but catastrophic in light mode (white card with a rust-red plate covering it). Restructured so the plate is a sibling of the card inside a positioning wrapper; paint order = document order; no z-index needed.
