---
"ornn-api": minor
---

LLM-based skill audit engine: new `skills/audit/` domain with 5-dimension scoring (security, code_quality, documentation, reliability, permission_scope), structured JSON findings, cache-by-hash persistence, and thresholds-based verdict (green / yellow / red). Endpoints: `GET /api/v1/skills/:idOrName/audit` (read-only, respects visibility) and `POST /api/v1/admin/skills/:idOrName/audit` (manual re-audit, admin only). Share-gated trigger is a separate follow-up (#95). Part of #32.
