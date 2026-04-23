---
"ornn-web": patch
---

Drop the `location = /api/v1/openapi.json` block from `ornn-web/nginx.conf.template` — no frontend code fetches it (the spec URL built in `ServiceDetailPage.tsx` / `GenerateSkillModal.tsx` goes through the NyxID proxy, not nginx). `/health`, SSE passthrough, gzip, static caching, SPA fallback, and NyxID X-Forwarded headers are kept.
