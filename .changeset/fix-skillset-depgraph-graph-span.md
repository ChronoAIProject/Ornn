---
"ornn-web": patch
---

Skillset detail: member dependencies graph now spans its full allocated RailCard height. Removed wasteful `my-4`/`p-4`/`minHeight`/`bg-page` chrome from the Mermaid container for the read-only case (via new optional `className` on `MermaidBlock`), wired `flex flex-col` on the graph's RailCard + `flex-1 min-h-0` so the diagram area claims the space after the card header. The SVG now utilizes the tall left column instead of sitting tiny inside large empty padding. (Also synced a stale HeroStrip test that was asserting removed version-picker/permissions UI.)