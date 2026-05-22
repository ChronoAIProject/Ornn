---
---

Polish the README `## How it works` Mermaid diagram for #707 — fixes from the #705 forge-palette render:
1. Subgraph titles use the DESIGN.md bracketed mono pattern (`[ § YOUR MACHINE ]` / `[ § ORNN CLOUD ]`) and drop the `ornn.chrono-ai.fun` suffix so they stop being clipped.
2. `edgeLabelBackground` set to canvas (`#0B0907`) so edge labels float on the dark background instead of rendering as dark-on-dark rectangles.
3. `clusterBkg` / `clusterBorder` set as defaults; `[ § YOUR MACHINE ]` lifted to `iron` (`#221E16`) while `[ § ORNN CLOUD ]` stays at `graphite` (`#14110B`) for a gentle material contrast.
4. Node and edge labels trimmed to one line (no more parenthetical subtitles) so the diagram fits the GitHub viewport without overflow.
5. Bonus: `CLI ==>|HTTPS| API` is thick + ember-tinted via `linkStyle 1` (the load-bearing action edge — single localized accent per DESIGN.md's allowance for wire / pulse effects), node strokes bumped to 1.5–2px for the "forged metal" feel, default `lineColor` dropped to `ash` so the ember edge wins the visual weight contest. Docs-only; no package code touched.
