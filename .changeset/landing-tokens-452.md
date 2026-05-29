---
"ornn-web": patch
---

Replace hardcoded hex literals on the landing pages with design tokens (#452). `PhoneMockup` (bezel edges, side buttons, camera lens) and `AnimatedTerminal` (traffic-light dots, terminal-output green) previously inlined `#1a1713`, `#2a2620`, `#0b1520`, `#3a5060`, `#c94a4a`, `#c9a64a`, `#5a9b5a`, `#7dc97d` in `bg-[…]` / `shadow-[…]` / arbitrary-gradient strings. Adds eight tokens under `@theme` in `neon.css` (`--color-bezel-edge`, `-rim`, `-lens-deep`, `-lens-rim`, `-traffic-{red,amber,green}`, `-terminal-ok`) and rewires both files to use the generated `bg-bezel-edge` / `text-terminal-ok` / `var(--color-…)` utilities. Visual output unchanged.
