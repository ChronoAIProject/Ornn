---
"ornn-api": minor
---

`api.request` PostHog event now also carries:

- **`userAgent`** — capped at 500 chars (truncate not redact). Distinguishes browser / ornn-sdk / curl / bots.
- **`queryParamKeys`** — sorted comma-joined list of query-string KEYS only (never values). 20-key cap. PII-safe by construction.
- **`requestBytes`** — Content-Length on the request body when set.
- **`responseBytes`** — Content-Length on the response when set (undefined for SSE/chunked).

All four are dropped when undefined rather than emitted with a sentinel — keeps PostHog property graphs clean.

Closes #314.
