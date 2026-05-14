---
"ornn-web": patch
---

LaunchCelebrationPopup redesign (#515) — full pass following DESIGN.md Forge Workshop language. Swaps every raw-var arbitrary class for semantic theme-aware tokens (`bg-card`, `text-strong`, `border-accent`, …) so dark + light both resolve cleanly. New visual structure: two-up offer tiles with big "200" numerals as the visual anchor, numbered redemption steps (01 / 02) with ember-mono numerals, click-to-copy invite-code chip in molten-gold mono, welded-seam divider with ember rivets, `★ Star on GitHub` primary CTA. Press-down behavior is centralized via `.cta-letterpress` — no more inline `box-shadow` strings (a DESIGN.md review-blocker). Closes #515.
