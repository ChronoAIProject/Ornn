---
---

Adds `examples/` with three minimal copy-paste starter skills (#469): `text-summarizer` (TS / LLM-backed), `csv-processor` (Python / stdlib-only deterministic), `api-fetch-wrapper` (TS / external HTTP with retries + no-leak errors). Each has a working `SKILL.md` with valid frontmatter, a short README, and an entrypoint that runs locally. Main README gains an `## Examples` section + nav anchor. Each example documents how to adapt it — the three failure-mode archetypes (LLM, pure-local, external HTTP) cover the patterns a real skill author actually has to handle.
