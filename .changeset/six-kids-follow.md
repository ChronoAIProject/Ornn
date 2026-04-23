---
"ornn-api": minor
---

Skill analytics: new `analytics` domain with append-only `skill_executions` event log + aggregation. `GET /api/v1/skills/:idOrName/analytics?window=7d|30d|all` returns execution count, success/failure/timeout breakdown, success rate, latency p50/p95/p99, unique users, top error codes. Visibility mirrors `GET /skills/:idOrName`. Emission hook points (playground / SDK / CLI) ship as a follow-up so this PR stays read-side-focused. Closes #34.
