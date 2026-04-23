---
"ornn-api": minor
---

New endpoint `GET /api/v1/skills/:idOrName/versions/:fromVersion/diff/:toVersion` returns a structured diff between two published versions: per-file added / removed / modified with SHA-256 hashes, byte sizes, and — for text files — both sides' contents (truncated at 64 KiB/side) so the UI can render any line-level diff client-side. Visibility rules mirror the canonical skill read. Part of #26.
