---
"ornn-api": patch
---

Drop unused `@xenova/transformers` dependency and bump `hono`, `yaml`, `mermaid`, `posthog-js`, `vite`, and several transitive packages to clear all 34 high/critical/moderate advisories flagged by `bun audit` on the previous lockfile. The matching CI `audit` gate ships in a follow-up PR.
