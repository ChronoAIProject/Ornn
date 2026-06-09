---
"ornn-api": patch
---

Server-side ZIP-bomb guards (cumulative/per-entry uncompressed caps, file-count, compression-ratio) are now enforced at the skill-ingestion chokepoint — covering both direct upload and the GitHub pull/refresh paths that previously bypassed the route-layer guard. Caps are env-overridable (#632)
