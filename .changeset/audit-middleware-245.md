---
"ornn-api": minor
---

backend: universal API audit middleware capturing every `/api/v1/*` request to MongoDB + MinIO. Truncates source IPs, strips identity-bearing headers, redacts request/response bodies via per-route whitelist + global blacklist (`password|token|apiKey|secret|key|credential`), classifies callers as web/agent/anonymous from auth shape with `X-Ornn-Caller` cross-check, offloads write/4xx/5xx bodies to gzip+MinIO when over the inline cap. Fail-isolated — Mongo / MinIO outages never propagate to business responses. Configurable via `AUDIT_RETENTION_DAYS` / `MINIO_AUDIT_BUCKET` / `AUDIT_BODY_INLINE_MAX_KB` / `AUDIT_GLOBAL_REDACT_PATTERNS`. Closes #245.
