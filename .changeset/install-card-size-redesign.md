---
"ornn-web": patch
---

Polish the install card after the height-unification attempt in #415. Drops the `min-h-[14rem]` padding that left a giant empty zone on the Via-npx tab; the CopyBlock itself is now a fixed `h-40` (160px) on both tabs with the single-line npx command vertically centred and the COPY button restored to a full-height vertical bar (no more disconnected look on Via-prompt).
