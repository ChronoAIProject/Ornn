---
"ornn-api": patch
---

Settings export now drops the `models` array from each LLM provider entry entirely. Previously trimmed to operator flags (#332); now removed. Model catalog is derived data — refreshed by Sync against the upstream gateway via /admin/settings/llm-providers — and doesn't belong in a portable settings export. Per-model flags ride out of band; re-set after Sync.

Provider container fields (gateway URL, auth, defaults) stay in the export.

Closes #335.
